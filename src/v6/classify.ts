/**
 * §6.1 v6 ①分類器（AI＝言語のみ・FR-84/95）。
 *
 * 新規建築の発話を「固有（specific）/ジェネリック（generic）/曖昧（ambiguous）」に分類し、
 * 検索/生成に使う subject（英語優先）・任意の styleHint・任意サイズ・信頼度を返す。
 * ★AI は言語処理のみ。形・座標・voxel には一切触れない（生成は v4 stage3 だけ）。
 * Claude 呼び出しは classify、判定パースは pure な parseClassification（テスト対象）。
 *
 * v4 の classifyIntent（character/parametric 2 分類）の置換。targetHeight は size として取り込む。
 */
import type Anthropic from "@anthropic-ai/sdk";
import { getClient, extractJson } from "../claude.js";
import { config } from "../config.js";
import { log } from "../log.js";

export type Category = "specific" | "generic" | "ambiguous";

export interface Classification {
  /** 固有/ジェネリック/曖昧（§6.1）。 */
  category: Category;
  /** 検索・生成・キャッシュキーに使う対象名（英語優先の固有名詞 or 一般名）。 */
  subject: string;
  /** 「ヨーロッパ風」等のスタイル形容（generic のパレットヒント・任意）。 */
  styleHint?: string;
  /** ユーザーが明示的に大きさを言ったときだけのサイズ（ブロック数・任意）。 */
  size?: number;
  /** 分類の信頼度 0..1（低いと曖昧扱い・§6.4 / FR-96）。 */
  confidence: number;
}

const SYSTEM_PROMPT = `あなたは Minecraft 建築アシスタントの「対象分類器」です。
新規建築の発話を、作る対象の性質で次の3カテゴリに分類します。

- "specific"（固有）：特定の実在物・名前のある建造物/キャラ。唯一のシルエットを持ち、正しい参照画像が要るもの。
  例：「東京タワー」「スカイツリー」「自由の女神」「ピカチュウ」「カービィ」。
- "generic"（ジェネリック）：一般名詞・型・スタイル付き一般名。画一的でよいもの。
  例：「塔」「家」「壁」「橋」「箱」「ヨーロッパ風の家」「適当な小屋」。スタイル形容は generic のまま styleHint へ。
- "ambiguous"（曖昧）：固有とも一般とも取れる（特定を指すか不明）。例：「お城」「教会」。

出力は次の JSON だけ（前置き・後置き・コードフェンス禁止）：
{
  "category": "specific" | "generic" | "ambiguous",
  "subject": "<検索/生成に使う対象名。固有は英語の固有名詞、一般は英語の一般名>",
  "styleHint": "<スタイル形容があれば。例 european, japanese, modern。無ければ省略>",
  "size": <整数。ユーザーが明示的に大きさを言ったときだけ。言及が無ければ絶対に含めない>,
  "confidence": <0.0..1.0 の分類確信度>
}

規則：
- subject は画像検索/生成に使うため英語にする（固有名は正式名称寄り）。
- size は「大きい/小さい/巨大/ミニ/○メートル/○ブロック」等の明示時だけ。「ちゃん/くん/さん」は敬称でサイズではない。目安：小=20 / ふつう=省略 / 大=40 / 巨大=60。
- styleHint は形容があるときだけ。無ければ含めない。
- 迷い（固有か一般か判断しづらい）は "ambiguous" にし、confidence を低めにする。
- 固有を generic と誤るのは致命的（東京タワーが箱になる）。確信が持てないなら generic より specific/ambiguous に倒す。`;

/** 任意の値 → Classification（不正・壊れは安全側：曖昧・空 subject・confidence 0）。 */
export function parseClassification(raw: unknown): Classification {
  if (typeof raw !== "object" || raw === null) {
    return { category: "ambiguous", subject: "", confidence: 0 };
  }
  const o = raw as Record<string, unknown>;
  const category: Category =
    o.category === "specific" || o.category === "generic" || o.category === "ambiguous"
      ? o.category
      : "ambiguous";
  const subject = typeof o.subject === "string" ? o.subject.trim() : "";
  const styleHint =
    typeof o.styleHint === "string" && o.styleHint.trim() !== "" ? o.styleHint.trim() : undefined;
  const size =
    typeof o.size === "number" && Number.isFinite(o.size) && o.size > 0 ? Math.round(o.size) : undefined;
  const confidence =
    typeof o.confidence === "number" && Number.isFinite(o.confidence)
      ? Math.min(1, Math.max(0, o.confidence))
      : 0;
  // subject が空なら分類として使えないので曖昧・低信頼に倒す（無言失敗を避け policy へ）。
  if (subject === "") return { category: "ambiguous", subject: "", confidence: 0 };
  return {
    category,
    subject,
    ...(styleHint !== undefined ? { styleHint } : {}),
    ...(size !== undefined ? { size } : {}),
    confidence,
  };
}

/** 発話を分類する。失敗時は安全側（曖昧・空 subject）＝後段ポリシーに委ねる。 */
export async function classify(utterance: string): Promise<Classification> {
  try {
    const resp = await getClient().messages.create({
      model: config.model,
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: utterance }],
    });
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    log.info("v6 分類 生出力", text);
    return parseClassification(JSON.parse(extractJson(text)));
  } catch (e) {
    log.warn("v6 分類に失敗、曖昧扱い", String(e));
    return { category: "ambiguous", subject: "", confidence: 0 };
  }
}
