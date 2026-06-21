/**
 * §6.3 ③ image→3D 生成（外部・★原則破り★・env ゲート・FR-62/68）。
 *
 * 画像を Meshy へ投入し、非同期ジョブを poll/timeout して .glb を取得・保存する。
 * MESHY_API_KEY 未設定 or 失敗/タイムアウト → throw（orchestrate が平面フォールバックへ）。
 * ★形を生成するのはこの段のみ。他段に生成ロジックを置かない。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import { log } from "../log.js";
import { makeMeshyProvider, type Mesh3DProvider } from "./adapters/meshy.js";

const POLL_INTERVAL_MS = 3000;
const TIMEOUT_MS = 5 * 60 * 1000;
const MAX_POLL_ERRORS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** ローカル画像 → data URI（Meshy へ渡す）。 */
function toDataUri(imagePath: string): string {
  const b64 = readFileSync(imagePath).toString("base64");
  return `data:image/png;base64,${b64}`;
}

/** 画像 → .glb を生成して保存し、そのローカルパスを返す。 */
export async function generate3D(imagePath: string, name: string, provider?: Mesh3DProvider): Promise<string> {
  if (!config.meshyApiKey.trim() && !provider) throw new Error("MESHY_API_KEY 未設定");
  const p = provider ?? makeMeshyProvider(config.meshyApiKey);

  const taskId = await p.submit(toDataUri(imagePath));
  log.info("3D生成ジョブ投入", { taskId });

  const deadline = Date.now() + TIMEOUT_MS;
  let glbUrl: string | undefined;
  let pollErrors = 0;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    let st;
    try {
      st = await p.poll(taskId);
    } catch (e) {
      if (++pollErrors > MAX_POLL_ERRORS) throw new Error(`3D生成 poll が連続失敗: ${String(e)}`);
      log.warn("3D生成 poll 一時失敗、リトライ", { taskId, error: String(e) });
      continue;
    }
    pollErrors = 0;
    log.info("3D生成 進捗", { status: st.status, progress: st.progress });
    if (st.status === "succeeded") { glbUrl = st.glbUrl; break; }
    if (st.status === "failed") throw new Error("3D生成ジョブが失敗");
  }
  if (!glbUrl) throw new Error("3D生成がタイムアウト");

  const resp = await fetch(glbUrl);
  if (!resp.ok) throw new Error(`glb DL が ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const dir = join(process.cwd(), "assets", "generated");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.glb`);
  writeFileSync(path, buf);
  log.info("生成3D を保存", { path });
  return path;
}
