/**
 * ③ image→3D 生成アダプタ（外部・Meshy）。★唯一の「形を生成する」段＝原則破りの局所★。
 * 非同期ジョブ型（submit → poll → DL）。別プロバイダは Mesh3DProvider を実装するだけ。
 * レスポンス解釈（parseMeshyStatus）は純粋関数でテスト対象、fetch 部は env キー必須。
 */

export type Gen3DStatus = "pending" | "running" | "succeeded" | "failed";

export interface Gen3DResult {
  status: Gen3DStatus;
  glbUrl?: string;
  progress?: number;
}

export interface Mesh3DProvider {
  /** 画像（data URI）を投入して taskId を得る。 */
  submit(imageDataUri: string): Promise<string>;
  /** taskId の状態を問い合わせる。 */
  poll(taskId: string): Promise<Gen3DResult>;
}

/** Meshy の image-to-3d レスポンス JSON → Gen3DResult（純粋）。 */
export function parseMeshyStatus(json: unknown): Gen3DResult {
  const o = (json ?? {}) as Record<string, unknown>;
  const s = String(o.status ?? "").toUpperCase();
  const status: Gen3DStatus =
    s === "SUCCEEDED" ? "succeeded"
    : s === "FAILED" || s === "CANCELED" || s === "EXPIRED" ? "failed"
    : s === "PENDING" ? "pending"
    : "running";
  const urls = o.model_urls as Record<string, unknown> | undefined;
  const glb = urls?.glb;
  return {
    status,
    glbUrl: typeof glb === "string" ? glb : undefined,
    progress: typeof o.progress === "number" ? o.progress : undefined,
  };
}

const BASE = "https://api.meshy.ai/openapi/v1/image-to-3d";

/** Meshy 実装を作る（apiKey 必須）。 */
export function makeMeshyProvider(apiKey: string): Mesh3DProvider {
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  return {
    async submit(imageDataUri: string): Promise<string> {
      const resp = await fetch(BASE, {
        method: "POST",
        headers,
        body: JSON.stringify({ image_url: imageDataUri }),
      });
      if (!resp.ok) throw new Error(`Meshy submit が ${resp.status}`);
      const j = (await resp.json()) as Record<string, unknown>;
      const id = j.result ?? j.id;
      if (typeof id !== "string" && typeof id !== "number") throw new Error("Meshy が taskId を返しません");
      return String(id);
    },
    async poll(taskId: string): Promise<Gen3DResult> {
      const resp = await fetch(`${BASE}/${taskId}`, { headers });
      if (!resp.ok) throw new Error(`Meshy poll が ${resp.status}`);
      return parseMeshyStatus(await resp.json());
    },
  };
}
