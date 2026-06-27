import "dotenv/config";

/**
 * 設定の一元管理（§3.3, §8）。
 * 値は環境変数（.env）から読み、未設定なら v0 の妥当な既定にフォールバックする。
 * API キーは Claude を実際に使うときだけ必要なので、ここでは存在を強制しない
 * （疎通スパイクは API キー無しで動かせる）。requireApiKey() で都度確認する。
 */
export interface Config {
  /** WS サーバーのバインド先ポート。Minecraft が /connect で繋いでくる先。 */
  port: number;
  /** Claude API キー。未設定なら空文字。 */
  apiKey: string;
  /** 発言→IR 生成に使うモデル文字列。 */
  model: string;
  /** これらの語を含む発言で建築を起動する（§4 FR-04）。 */
  triggerWords: string[];
  /** これらの語を含む発言で直前の建築を Undo する（§6.4）。 */
  undoWords: string[];
  /** v5：これらの語を含む発言で「現在の対象」の修正ループを起動する（§6.3 / FR-73）。 */
  editWords: string[];
  /** v5：確認保留中（曖昧/作り直し）の肯定応答（§6.5）。 */
  confirmYesWords: string[];
  /** v5：確認保留中の否定応答（§6.5）。 */
  confirmNoWords: string[];
  /** v5：GridIR アセットを永続化するライブラリのディレクトリ（§3 / FR-70）。 */
  libraryDir: string;
  /** v4/v5：サイズ無指定のキャラ生成の既定の高さ（ブロック数）。env DEFAULT_CHARACTER_HEIGHT で調整。 */
  characterHeight: number;
  /** 素材検証で不明 ID だったときの代替（§6.3 FR-09）。 */
  fallbackMaterial: string;
  /** v4 ②画像取得（SerpAPI）キー。未設定なら v4 パイプラインは無効。 */
  imageSearchApiKey: string;
  /** v4 ③image→3D（Meshy）キー。未設定なら立体生成不可（平面フォールバック）。 */
  meshyApiKey: string;
  /** v6：曖昧/低信頼の経路ポリシー。"generation"=生成寄り（既定）/"confirm"=1問確認（§6.4）。 */
  v6AmbiguityPolicy: "generation" | "confirm";
  /** v6：固有の参照同定不能時のポリシー。"notify"=通知して停止（既定）/"flat"=最良候補で試行（§6.5）。 */
  v6UnidentifiedPolicy: "notify" | "flat";
  /** v6：分類の信頼度しきい値。これ未満は曖昧扱い（§6.4 / FR-96）。 */
  v6ClassifyConfidence: number;
  /** v6：リファレンス識別で取得する候補画像数（多めに取り webp 脱落分を吸収・§6.3）。 */
  v6RefCandidates: number;
  /** v6：vision 検証の採用スコアしきい値（0..1）。strict はこれを底上げ（§6.3 / FR-89）。 */
  v6RefMinScore: number;
  /** v6：vision 検証に使うモデル。未設定なら model を流用。 */
  visionModel: string;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** 小数しきい値用（intFromEnv は整数専用なので分ける・v6 の confidence/score）。 */
function numFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const config: Config = {
  port: intFromEnv("PORT", 19131),
  apiKey: process.env.ANTHROPIC_API_KEY ?? "",
  model: process.env.MODEL?.trim() || "claude-sonnet-4-6",
  // 漢字・ひらがな両方を拾う（ユーザーは「たてて」とも書く）。
  triggerWords: ["建てて", "たてて", "建てろ", "たてろ", "作って", "つくって", "架けて", "かけて", "build"],
  undoWords: ["もどして", "戻して", "取り消して", "とりけして", "undo"],
  // v5：修正ループの明示トリガー。これらを含む発言だけ EditOp 解釈に回す（雑談の誤解釈を防ぐ）。
  // よく使う編集動詞（反転/回転/動かす/拡縮）も拾い、「なおして」を付けなくても修正に入れる。
  editWords: [
    "なおして", "直して", "修正", "へんしゅう", "編集", "変えて", "かえて", "edit",
    "反転", "回転", "回して", "まわして", "動かして", "移動", "大きく", "小さく", "でかく", "ちいさく",
  ],
  // v5：確認保留（曖昧/作り直し）への応答語。
  confirmYesWords: ["はい", "うん", "いいよ", "おねがい", "お願い", "yes", "ok", "ｏｋ"],
  confirmNoWords: ["いいえ", "やめて", "やめ", "no", "キャンセル", "ちがう"],
  // v5：ライブラリ保存先（個人・ローカル利用前提・§3）。
  libraryDir: process.env.LIBRARY_DIR?.trim() || "library",
  // 既定キャラ高さ。grid 各軸上限 64 があるので、横長キャラを縮ませないため既定 48（≒安全上限）。
  characterHeight: intFromEnv("DEFAULT_CHARACTER_HEIGHT", 48),
  fallbackMaterial: "minecraft:stone",
  imageSearchApiKey: process.env.SERPAPI_API_KEY ?? "",
  meshyApiKey: process.env.MESHY_API_KEY ?? "",
  // v6：経路ポリシー＆リファレンス識別の調整値（すべて env で変更可・FR-96）。
  v6AmbiguityPolicy: process.env.V6_AMBIGUITY_POLICY?.trim() === "confirm" ? "confirm" : "generation",
  v6UnidentifiedPolicy: process.env.V6_UNIDENTIFIED_POLICY?.trim() === "flat" ? "flat" : "notify",
  v6ClassifyConfidence: numFromEnv("V6_CLASSIFY_CONFIDENCE", 0.6),
  v6RefCandidates: intFromEnv("V6_REF_CANDIDATES", 8),
  v6RefMinScore: numFromEnv("V6_REF_MIN_SCORE", 0.6),
  visionModel: process.env.VISION_MODEL?.trim() || process.env.MODEL?.trim() || "claude-sonnet-4-6",
};

/**
 * v4「喋るだけ」パイプラインが使えるか（②画像取得キーがあるか）。
 * 未設定なら「○○作って」は既存パラメトリック経路のみで処理する（余分な Claude 呼び出しもしない）。
 */
export function pipelineEnabled(): boolean {
  return config.imageSearchApiKey.trim() !== "";
}

/** Claude を使う直前に呼ぶ。キー未設定なら明示的に失敗させる。 */
export function requireApiKey(): string {
  if (!config.apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY が未設定です。.env に設定してください（.env.example 参照）。",
    );
  }
  return config.apiKey;
}
