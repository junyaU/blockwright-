/**
 * §6.3 v6 ③リファレンス識別（固有経路の中核・FR-88/89/95）。
 *
 * 固有名から「正しい参照」を取り違えずに得る。v4 stage2（画像 1 枚取得）の格上げ：
 *   正規化クエリ構築（AI 言語）→ 候補を複数取得（外部）→ AI vision で一致/単体/クリーン/正面を
 *   検証・再ランク → 最良 1 枚。確信できる候補が無ければ confident:false（router が §6.5 へ）。
 *
 * ★AI は言語（クエリ正規化）と vision（一致確認・選別）の判定のみ。形・座標・voxel には触れない。
 *   選定画像は v4 生成（stage3 以降）へ渡す。形を作るのは generate3D だけ。
 * I/O（検索・取得・vision・保存）はすべて deps 経由で注入し、選定ロジックを純粋に近く保つ（テスト容易）。
 */
import type Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Jimp } from "jimp";
import { getClient, extractJson } from "../claude.js";
import { config } from "../config.js";
import { log } from "../log.js";
import { slug } from "../pipeline/image.js";
import { makeSerpApiSearch, type ImageSearchAdapter, type ImageCandidate } from "../pipeline/adapters/imageSearch.js";

/** vision が各候補に付ける採点（0..1）。score は総合。 */
export interface VisionScore {
  index: number;
  /** 指定の固有物と一致するか。 */
  match: number;
  /** 単体被写体か。 */
  single: number;
  /** 背景がクリーンか。 */
  clean: number;
  /** 正面寄りか。 */
  frontal: number;
  /** 総合スコア。 */
  score: number;
}

/** リファレンス識別の結果（confident=採用しきい値を満たしたか）。 */
export interface Reference {
  /** 選定画像の保存パス（v4 生成へ渡す・assets/generated/<slug>.png）。 */
  path: string;
  /** 採用された総合スコア。 */
  score: number;
  /** 実際に使った正規化クエリ（ログ/デバッグ）。 */
  query: string;
  /** しきい値を満たした確信ありの選定か（false なら router が §6.5 へ）。 */
  confident: boolean;
}

/** vision 検証器（差し替え/テスト用に注入）。 */
export interface VisionVerifier {
  score(thumbs: { b64: string }[], subject: string): Promise<VisionScore[]>;
}

/** identifyReference の依存（既定は実 I/O・テストはフェイクを注入）。 */
export interface IdentifyDeps {
  adapter: ImageSearchAdapter;
  verifier: VisionVerifier;
  /** 固有名 → 一意化検索クエリ（AI 言語）。 */
  normalize(subject: string): Promise<string>;
  /** URL → 生バイト（取得）。 */
  fetchBytes(url: string): Promise<Buffer>;
  /** 生バイト → JPEG サムネ base64（jimp・webp/avif 等は throw）。 */
  prepareThumb(bytes: Buffer): Promise<string>;
  /** 生バイトを保存してパスを返す。 */
  saveImage(bytes: Buffer, name: string): string;
}

const THUMB_MAX_SIDE = 320;

const NORMALIZE_SYSTEM = `あなたは画像検索クエリの正規化器です。
入力の対象名（特定の実在物・建造物・キャラクター等）について、その対象を一意に絞り込み、
素直な正面・単体・クリーンな公式アート/写真が引きやすい英語の画像検索クエリを 1 つ作ります。
- 正式名称化・曖昧さ回避の補語（国/地域・ランドマーク/キャラとしての限定）を必要に応じて付ける。
- "front view" "official" 等、正面・単体になりやすい語を添える。"full body" は躍動ポーズを招くので避ける。
出力は JSON だけ（前置き・コードフェンス禁止）：{ "query": "<英語の検索クエリ>" }`;

const VISION_SYSTEM = `あなたは画像の一致確認・選別器です。各画像が、指定された固有の対象として正しい参照かを評価します。
形・座標・ブロックには一切触れず、画像の見た目だけを判定します。
各画像について 0.0..1.0 で採点：
- match: 指定の固有対象と一致するか（別物・同名異物は低く）
- single: 単体被写体か（複数/コラージュは低く）
- clean: 背景がクリーンか（雑多な背景は低く）
- frontal: 正面寄り・直立か（横向き/極端なポーズは低く）
- score: 総合（match を最重視）
出力は JSON だけ（前置き・コードフェンス禁止）：
{ "scores": [ { "index": <画像番号>, "match": <0..1>, "single": <0..1>, "clean": <0..1>, "frontal": <0..1>, "score": <0..1> }, ... ] }`;

function clamp01(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** vision 出力（{scores:[...]} または素の配列）→ VisionScore[]（純粋・件数照合・壊れは空）。 */
export function parseVisionScores(raw: unknown, n: number): VisionScore[] {
  const arr = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { scores?: unknown })?.scores)
      ? (raw as { scores: unknown[] }).scores
      : null;
  if (!arr) return [];
  const out: VisionScore[] = [];
  for (const item of arr) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const index =
      typeof o.index === "number" && Number.isFinite(o.index) ? Math.round(o.index) : NaN;
    if (!Number.isInteger(index) || index < 0 || index >= n) continue;
    const match = clamp01(o.match);
    const single = clamp01(o.single);
    const clean = clamp01(o.clean);
    const frontal = clamp01(o.frontal);
    // score 明示が無ければ加重平均（match を最重視）。
    const score =
      typeof o.score === "number" && Number.isFinite(o.score)
        ? clamp01(o.score)
        : 0.55 * match + 0.2 * single + 0.15 * clean + 0.1 * frontal;
    out.push({ index, match, single, clean, frontal, score });
  }
  return out;
}

/** 固有名 → 一意化検索クエリ（AI 言語）。失敗時は素の subject にフォールバック。 */
export async function normalizeQuery(subject: string): Promise<string> {
  try {
    const resp = await getClient().messages.create({
      model: config.model,
      max_tokens: 120,
      system: NORMALIZE_SYSTEM,
      messages: [{ role: "user", content: subject }],
    });
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const parsed = JSON.parse(extractJson(text)) as { query?: unknown };
    if (typeof parsed.query === "string" && parsed.query.trim() !== "") {
      const q = parsed.query.trim();
      log.info("正規化クエリ", { subject, query: q });
      return q;
    }
  } catch (e) {
    log.warn("クエリ正規化に失敗、素の subject を使用", { subject, error: String(e) });
  }
  return subject;
}

/** Claude vision で候補を採点する実装。N 枚を 1 メッセージに詰めて送る（コスト/往復を最小化）。 */
export function makeClaudeVisionVerifier(): VisionVerifier {
  return {
    async score(thumbs, subject): Promise<VisionScore[]> {
      const content: Anthropic.ContentBlockParam[] = [];
      thumbs.forEach((t, i) => {
        content.push({ type: "text", text: `画像${i}：` });
        content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: t.b64 } });
      });
      content.push({
        type: "text",
        text: `上の画像0..${thumbs.length - 1} は「${subject}」の参照候補です。各画像を採点してください。`,
      });
      const resp = await getClient().messages.create({
        model: config.visionModel,
        max_tokens: 700,
        system: VISION_SYSTEM,
        messages: [{ role: "user", content }],
      });
      const text = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      log.info("vision 採点 生出力", text);
      return parseVisionScores(JSON.parse(extractJson(text)), thumbs.length);
    },
  };
}

/** 生バイト → JPEG サムネ base64（jimp で正規化・縮小。webp/avif 等はデコード不可で throw）。 */
async function defaultPrepareThumb(bytes: Buffer): Promise<string> {
  const img = await Jimp.read(bytes);
  const { width, height } = img.bitmap;
  if (Math.max(width, height) > THUMB_MAX_SIDE) {
    if (width >= height) img.resize({ w: THUMB_MAX_SIDE });
    else img.resize({ h: THUMB_MAX_SIDE });
  }
  const out = await img.getBuffer("image/jpeg");
  return out.toString("base64");
}

async function defaultFetchBytes(url: string): Promise<Buffer> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`画像取得が ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

function defaultSaveImage(bytes: Buffer, name: string): string {
  const dir = join(process.cwd(), "assets", "generated");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.png`); // jimp/Meshy は内容で形式判定するので拡張子は便宜的
  writeFileSync(path, bytes);
  return path;
}

function defaultDeps(): IdentifyDeps {
  return {
    adapter: makeSerpApiSearch(config.imageSearchApiKey),
    verifier: makeClaudeVisionVerifier(),
    normalize: normalizeQuery,
    fetchBytes: defaultFetchBytes,
    prepareThumb: defaultPrepareThumb,
    saveImage: defaultSaveImage,
  };
}

interface Prepared {
  candidate: ImageCandidate;
  b64: string;
  bytes: Buffer;
}

/**
 * 固有名 → 最良の参照画像 1 枚。
 * 候補ゼロ／全候補デコード不可なら null。それ以外は最良候補を保存して返す（confident はしきい値判定）。
 * strict はしきい値を底上げ（固有の取り違え回避を厳しめに・§6.3）。
 */
export async function identifyReference(
  subject: string,
  opts: { strict: boolean },
  deps: Partial<IdentifyDeps> = {},
): Promise<Reference | null> {
  const d: IdentifyDeps = { ...defaultDeps(), ...deps };

  // ① 正規化クエリ → ② 候補取得（クエリで 0 件なら素の subject でも試す）。
  const query = await d.normalize(subject);
  let candidates: ImageCandidate[] = [];
  for (const q of query === subject ? [query] : [query, subject]) {
    try {
      candidates = await d.adapter.search(q);
    } catch (e) {
      log.warn("候補画像の検索に失敗", { subject, query: q, error: String(e) });
      candidates = [];
    }
    if (candidates.length > 0) break;
  }
  if (candidates.length === 0) {
    log.warn("候補画像が 0 件", { subject, query });
    return null;
  }
  candidates = candidates.slice(0, config.v6RefCandidates);

  // ③ サムネ準備（デコード不可＝webp/avif 等は skip）。
  const prepared: Prepared[] = [];
  for (const c of candidates) {
    try {
      const bytes = await d.fetchBytes(c.url);
      const b64 = await d.prepareThumb(bytes);
      prepared.push({ candidate: c, b64, bytes });
    } catch (e) {
      log.warn("候補のサムネ化に失敗（skip）", { url: c.url, error: String(e) });
    }
  }
  if (prepared.length === 0) {
    log.warn("デコード可能な候補が無い", { subject, fetched: candidates.length });
    return null;
  }

  // ④ vision 検証・再ランク。失敗時は決定論フォールバック（先頭・低信頼）。
  let scores: VisionScore[] = [];
  try {
    scores = await d.verifier.score(
      prepared.map((p) => ({ b64: p.b64 })),
      subject,
    );
  } catch (e) {
    log.warn("vision 検証に失敗、先頭候補に決定論フォールバック", { subject, error: String(e) });
  }
  let best: VisionScore | null = null;
  for (const s of scores) if (!best || s.score > best.score) best = s;
  if (!best) best = { index: 0, match: 0, single: 0, clean: 0, frontal: 0, score: 0 };

  const threshold = Math.min(0.95, config.v6RefMinScore + (opts.strict ? 0.1 : 0));
  const confident = best.score >= threshold;
  const chosen = prepared[best.index]!;

  // ⑤ 最良候補を保存（confident でなくても保存＝flat ポリシーが使えるように）。
  const path = d.saveImage(chosen.bytes, slug(subject));
  log.info("リファレンス識別", {
    subject,
    query,
    chosenIndex: best.index,
    score: Number(best.score.toFixed(3)),
    threshold,
    confident,
    candidateCount: prepared.length,
    scores: scores.map((s) => ({ i: s.index, score: Number(s.score.toFixed(3)) })),
  });
  return { path, score: best.score, query, confident };
}
