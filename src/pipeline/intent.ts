/**
 * §6.1 ① 意図抽出（AI＝言語のみ・FR-59/69）。
 *
 * 発話を「特定キャラ/物体の取得対象（character）」か「パラメトリック建築（parametric）」かに
 * 分類し、character なら検索語 subject（英語優先）と任意サイズを返す。
 * ★AI は言語処理のみ。形・座標・voxel には一切触れない。
 * Claude 呼び出しは classifyIntent、判定パースは pure な parseIntent（テスト対象）。
 */
import type Anthropic from "@anthropic-ai/sdk";
import { getClient } from "../claude.js";
import { config } from "../config.js";
import { log } from "../log.js";

export type Intent =
  | { kind: "character"; subject: string; targetHeight?: number }
  | { kind: "parametric" };

const SYSTEM_PROMPT = `あなたは Minecraft 建築アシスタントの意図分類器です。
ユーザーの発話が「特定のキャラクター・人物・動物・物体など、見た目を再現するために参照画像が要るもの」を
作る依頼か、「家・塔・壁・橋・箱のような一般的な構造物（パラメトリックに作れるもの）」かを判定します。

出力は次の JSON だけ（前置き・コードフェンス禁止）：
- 参照画像が要る具体物：{ "kind": "character", "subject": "<英語の検索語>", "targetHeight": <整数 省略可> }
- 一般構造物：{ "kind": "parametric" }

★targetHeight の規則（重要）：
- ユーザーが**明示的に大きさを言ったときだけ**含める（「大きい」「小さい」「巨大」「ミニ」「○メートル」「○ブロック」等）。
- サイズに言及していなければ **targetHeight は絶対に含めない**（既定サイズで建てる）。勝手に数値を入れない。
- 「ちゃん」「くん」「さん」は敬称であって大きさではない。サイズ指定とみなさない。
- 目安：小さい=20、ふつう=省略、大きい=40、巨大=60。

例：
- 「カービィ作って」→ { "kind": "character", "subject": "Kirby" }
- 「ドラミちゃん作って」→ { "kind": "character", "subject": "Dorami" }   ← 「ちゃん」はサイズではない。targetHeight 無し
- 「大きいピカチュウ」→ { "kind": "character", "subject": "Pikachu", "targetHeight": 40 }
- 「小さいスヌーピー」→ { "kind": "character", "subject": "Snoopy", "targetHeight": 20 }
- 「石の家を建てて」→ { "kind": "parametric" }
- 「塔を作って」→ { "kind": "parametric" }
- 「赤いキノコの家」→ { "kind": "parametric" }
subject は画像検索に使うため英語の固有名詞にする。迷ったら parametric。`;

/** Claude 出力から JSON 本体（最初の { 〜 最後の }）を取り出す。 */
function extractJson(text: string): string {
  const t = text.trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  return start !== -1 && end > start ? t.slice(start, end + 1) : t;
}

/** 任意の値 → Intent（不正・曖昧は安全側 parametric）。 */
export function parseIntent(raw: unknown): Intent {
  if (typeof raw !== "object" || raw === null) return { kind: "parametric" };
  const o = raw as Record<string, unknown>;
  if (o.kind === "character" && typeof o.subject === "string" && o.subject.trim() !== "") {
    const th = typeof o.targetHeight === "number" && Number.isFinite(o.targetHeight)
      ? Math.round(o.targetHeight)
      : undefined;
    return { kind: "character", subject: o.subject.trim(), ...(th !== undefined ? { targetHeight: th } : {}) };
  }
  return { kind: "parametric" };
}

/** 発話を分類する。失敗時は安全側 parametric（既存経路に委ねる）。 */
export async function classifyIntent(utterance: string): Promise<Intent> {
  try {
    const resp = await getClient().messages.create({
      model: config.model,
      max_tokens: 150,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: utterance }],
    });
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    log.info("意図分類 生出力", text);
    return parseIntent(JSON.parse(extractJson(text)));
  } catch (e) {
    log.warn("意図分類に失敗、parametric 扱い", String(e));
    return { kind: "parametric" };
  }
}
