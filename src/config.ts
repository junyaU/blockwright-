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
  /** 素材検証で不明 ID だったときの代替（§6.3 FR-09）。 */
  fallbackMaterial: string;
  /** v4 ②画像取得（SerpAPI）キー。未設定なら v4 パイプラインは無効。 */
  imageSearchApiKey: string;
  /** v4 ③image→3D（Meshy）キー。未設定なら立体生成不可（平面フォールバック）。 */
  meshyApiKey: string;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config: Config = {
  port: intFromEnv("PORT", 19131),
  apiKey: process.env.ANTHROPIC_API_KEY ?? "",
  model: process.env.MODEL?.trim() || "claude-sonnet-4-6",
  // 漢字・ひらがな両方を拾う（ユーザーは「たてて」とも書く）。
  triggerWords: ["建てて", "たてて", "建てろ", "たてろ", "作って", "つくって", "架けて", "かけて", "build"],
  undoWords: ["もどして", "戻して", "取り消して", "とりけして", "undo"],
  fallbackMaterial: "minecraft:stone",
  imageSearchApiKey: process.env.SERPAPI_API_KEY ?? "",
  meshyApiKey: process.env.MESHY_API_KEY ?? "",
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
