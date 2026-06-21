/**
 * §6.2 C2: Claude API クライアント。発言 → IR(JSON) を生成する。
 *
 * 出力は §5.2 スキーマに厳密準拠した JSON のみ。AI に生コマンドは絶対に吐かせない。
 * パース失敗・スキーマ不一致時はリトライ 1 回 → なお失敗なら結果型で失敗を返す
 * （呼び出し側がゲーム内チャットで通知する）。
 */
import Anthropic from "@anthropic-ai/sdk";
import { config, requireApiKey } from "./config.js";
import { parseIR, type IR } from "./ir.js";
import { log } from "./log.js";

const SYSTEM_PROMPT = `あなたは Minecraft 統合版の建築指示を構造化する変換器です。
ユーザーの発言を、次のいずれかの JSON スキーマに**厳密準拠した JSON のみ**に変換してください。
あなたが埋めるのは**パラメータだけ**です。座標・コマンド・ブロックの並びは一切出力しないこと（幾何はコードが計算します）。

【box】単純な塊・台・壁・柱などに使う:
{
  "type": "box",
  "size": { "w": <整数 1..64>, "d": <整数 1..64>, "h": <整数 1..64> },
  "material": "<実在する統合版ブロックID。例 minecraft:oak_planks>",
  "hollow": <true または false>
}

【house】家・小屋・住居など「人が住む建物」に使う:
{
  "type": "house",
  "footprint": { "w": <整数 5..32>, "d": <整数 5..32> },
  "height": <壁の高さ 整数 3..12>,
  "roof": "flat" | "gable",
  "roofOverhang": <軒の張り出し 0..2 省略可>,
  "door": { "position": "center" | <整数> },
  "windows": { "pattern": "none" | "even", "count": <整数 省略可>, "sill": <整数 省略可> },
  "style": "rustic" | "stone" | "modern",
  "facing": "auto"
}

【tower】塔・櫓・見張り台・灯台・要塞の塔など「縦に細長く高い建造物」に使う:
{
  "type": "tower",
  "footprint": { "w": <整数 3..16>, "d": <整数 3..16> },
  "height": <塔身の高さ 整数 5..48>,
  "cap": "flat" | "battlement",
  "shape": "square",
  "door": { "position": "center" | <整数> },
  "windows": { "pattern": "none" | "slit", "count": <整数 省略可>, "sill": <整数 省略可>, "span": <整数 省略可> },
  "style": "rustic" | "stone" | "modern",
  "facing": "auto"
}

【wall】防壁・城壁・塀・柵など「長い直線状の壁」に使う:
{
  "type": "wall",
  "length": <壁の長さ 整数 5..64>,
  "height": <壁の高さ 整数 3..16>,
  "thickness": <厚み 整数 1..4 省略可>,
  "crenellation": <true=城壁風のギザギザ / false=平ら, 省略可>,
  "gate": { "position": "center" | <整数>, "width": <整数 省略可>, "height": <整数 省略可> },
  "style": "rustic" | "stone" | "modern",
  "facing": "auto"
}

【bridge】橋・桟橋・歩道橋など「水平に渡す通路」に使う:
{
  "type": "bridge",
  "span": <橋の長さ 整数 5..64>,
  "width": <橋の幅 整数 2..16>,
  "railing": <両側の欄干を付けるか true/false 省略可>,
  "piers": <下方向の橋脚を付けるか true/false 省略可>,
  "style": "rustic" | "stone" | "modern",
  "facing": "auto"
}

選択指針:
- 居住物（家・小屋・コテージ）→ "house"。縦に高い建造物（塔・櫓・灯台）→ "tower"。長い直線の壁（防壁・城壁・塀・柵）→ "wall"。水平に渡す通路（橋・桟橋）→ "bridge"。単純な塊・台 → "box"。
- house/tower/wall/bridge では素材は基本 "style" 名で指定する（コードが壁/床/屋根に確実展開する）。特定ブロックを面ごとに指定したいときのみ "palette": { "wall":..., "floor":..., "roof":..., "trim":..., "window":... } を使う。
- これらの facing は基本 "auto"（プレイヤーの向きに合わせる）。
- 三角屋根/切妻なら roof:"gable"、陸屋根/平らなら roof:"flat"。迷ったら "gable"。
- tower の上部は、城壁風のギザギザ（胸壁）なら cap:"battlement"、平らな屋上なら cap:"flat"。迷ったら "battlement"。
- tower/wall/bridge は石造が自然なので style は基本 "stone"。tower の窓は縦長の "slit"（狭間）、shape は "square" のみ。
- wall は城壁風なら crenellation:true。出入口が要るなら gate を付ける。
- bridge は欄干 railing:true が基本。橋脚 piers は地面まで支柱を伸ばしたいとき true。

共通規則:
- 出力は JSON オブジェクト 1 個だけ。前置き・後置き・説明・Markdownのコードフェンス(\`\`\`)を一切付けない。
- 寸法は各スキーマの範囲内で出す（最終調整はコード側が行う）。
- material/ブロックIDは実在する統合版のものにする。`;

export type GenerateResult =
  | { ok: true; ir: IR; warnings: string[] }
  | { ok: false; error: string };

/** Claude 出力テキストから JSON 本体を取り出す（前後の余分やコードフェンスを除去）。 */
function extractJson(text: string): string {
  let t = text.trim();
  // ```json ... ``` のようなフェンスが付いていても剥がす。
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) t = fence[1].trim();
  // 最初の { から最後の } までを取る。
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return t.slice(start, end + 1);
  }
  return t;
}

let client: Anthropic | undefined;
/** Anthropic クライアントを遅延生成して共有する（intent 抽出など他経路も再利用）。 */
export function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: requireApiKey() });
  return client;
}

async function callOnce(utterance: string): Promise<GenerateResult> {
  const resp = await getClient().messages.create({
    model: config.model,
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: utterance }],
  });
  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  log.info("Claude 生出力", text);

  let raw: unknown;
  try {
    raw = JSON.parse(extractJson(text));
  } catch {
    return { ok: false, error: "Claude 出力を JSON としてパースできませんでした。" };
  }
  const parsed = parseIR(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, ir: parsed.ir, warnings: parsed.warnings };
}

/** 発言から IR を生成する。失敗時はリトライ 1 回。 */
export async function generateIR(utterance: string): Promise<GenerateResult> {
  try {
    const first = await callOnce(utterance);
    if (first.ok) return first;
    log.warn("IR 生成に失敗。リトライします。", first.error);
    return await callOnce(utterance);
  } catch (e) {
    log.error("Claude API 呼び出しで例外", String(e));
    return { ok: false, error: "Claude API の呼び出しに失敗しました。" };
  }
}
