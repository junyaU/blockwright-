/**
 * §6.2 ② 画像取得（外部・FR-60/61）。
 *
 * subject で画像検索 → 1 枚選定（大きめ＝正面/単体になりやすい）→ DL → assets/generated 保存。
 * 取得画像は fallback（v3.0 平面建築）用に保持する。失敗時は null（呼び出し側が失敗通知）。
 * 背景除去は v4.0 では未実施（将来）。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import { log } from "../log.js";
import { makeSerpApiSearch, type ImageCandidate } from "./adapters/imageSearch.js";

export interface AcquiredImage {
  path: string;
}

/** ファイル名用の slug。 */
export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "subject";
}

/** アスペクト比（>=1）。これ以下を「単体・正面になりやすい正方形寄り」とみなす。 */
export const MAX_ASPECT = 1.7;
/** 小さすぎるサムネ/アイコンを避ける最小短辺（px）。 */
export const MIN_SIDE_PX = 200;

/** アスペクト比（長辺/短辺、>=1）。寸法不明は最劣後（Infinity）。 */
function aspectRatio(c: ImageCandidate): number {
  const w = c.width ?? 0, h = c.height ?? 0;
  if (w <= 0 || h <= 0) return Infinity;
  return Math.max(w, h) / Math.min(w, h);
}

function minSide(c: ImageCandidate): number {
  return Math.min(c.width ?? 0, c.height ?? 0);
}

/**
 * 候補から最良の 1 枚を選ぶ（純粋）。
 * ポーズ（躍動/小物）はメタデータから判別できないので、検索エンジンの**関連度順を尊重**し、
 * 「正方形寄り（aspect ≤ MAX_ASPECT）かつ十分大きい（短辺 ≥ MIN_SIDE_PX）」候補の**先頭**を選ぶ。
 * 良いクエリ（front view official artwork 等）の上位ほど素直な正面アートが来やすい（R4）。
 * 該当が無ければ段階的に条件を緩め、最後は関連度先頭。
 */
export function selectBestImage(candidates: ImageCandidate[]): ImageCandidate | null {
  if (candidates.length === 0) return null;
  const good = candidates.filter((c) => aspectRatio(c) <= MAX_ASPECT && minSide(c) >= MIN_SIDE_PX);
  if (good.length > 0) return good[0]!;
  const squareish = candidates.filter((c) => aspectRatio(c) <= MAX_ASPECT);
  if (squareish.length > 0) return squareish[0]!;
  return candidates[0]!;
}

/** subject の参照画像を取得して保存する。 */
export async function acquireImage(subject: string): Promise<AcquiredImage | null> {
  if (!config.imageSearchApiKey.trim()) {
    log.warn("画像検索キー未設定。画像取得をスキップ", { subject });
    return null;
  }

  let candidates: ImageCandidate[] = [];
  try {
    const adapter = makeSerpApiSearch(config.imageSearchApiKey);
    // 正面・直立・小物なしの素直な公式アートを引きやすい順に試し、最初に当たったものを使う。
    // （"full body" は躍動ポーズ＋小物のアートを引きやすいので避ける／R4）
    const queries = [
      `${subject} front view official artwork transparent background`,
      `${subject} transparent background`,
      subject,
    ];
    for (const q of queries) {
      candidates = await adapter.search(q);
      if (candidates.length > 0) {
        log.info("画像検索クエリ", { query: q, count: candidates.length });
        break;
      }
    }
  } catch (e) {
    log.warn("画像検索に失敗", { subject, error: String(e) });
    return null;
  }

  const pick = selectBestImage(candidates);
  if (!pick) {
    log.warn("画像候補が見つかりません", { subject });
    return null;
  }

  try {
    const resp = await fetch(pick.url);
    if (!resp.ok) throw new Error(`画像 DL が ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    const dir = join(process.cwd(), "assets", "generated");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${slug(subject)}.png`); // jimp は内容で形式判定するので拡張子は便宜的
    writeFileSync(path, buf);
    log.info("参照画像を取得", { subject, url: pick.url, path });
    return { path };
  } catch (e) {
    log.warn("画像 DL に失敗", { subject, error: String(e) });
    return null;
  }
}
