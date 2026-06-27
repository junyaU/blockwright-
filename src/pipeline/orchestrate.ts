/**
 * v4 パイプライン束ね（②③④⑤＋品質ゲート＋フォールバック）。
 *
 * 出口は常に GridIR（立体 or 平面）。server/build/Undo には触れない（I/O は index 側）。
 * 形を生成するのは generate3D（③）のみ。acquire/cleanup/voxelize/gate/flat は決定論/取得（R1）。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { GridIR } from "../ir.js";
import { config } from "../config.js";
import { log, time } from "../log.js";
import { acquireImage, slug } from "./image.js";
import { generate3D } from "./gen3d.js";
import { cleanupMesh } from "./cleanup.js";
import { qualityGate } from "./gate.js";
import { loadMesh, trisToGridIR } from "../voxelize/mesh.js";
import { imageToGridIR } from "../voxelize/image.js";

export type ResolveResult =
  | { ok: true; ir: GridIR; mode: "3d" | "flat" }
  | { ok: false; error: string };

/** 生成3Dの保存先（gen3d.ts と一致）。slug 単位でキャッシュキーになる。 */
function glbPathFor(subject: string): string {
  return join(process.cwd(), "assets", "generated", `${slug(subject)}.glb`);
}

/** glb → GridIR（④清掃 → ⑤ボクセル化 → 品質ゲート）。不合格は throw。決定論。 */
async function gridFromGlb(glb: string, targetHeight?: number): Promise<GridIR> {
  const tris = await loadMesh(glb); // v3.1 読込
  const clean = cleanupMesh(tris); // ④ 決定論
  const ir = trisToGridIR(clean, { fill: "solid", targetHeight }); // ⑤ v3.1 不変
  const gate = qualityGate(ir);
  log.info("品質ゲート", { ok: gate.ok, ...gate.stats });
  if (!gate.ok) throw new Error(`品質ゲート不合格: ${gate.reasons.join(", ")}`);
  return ir;
}

/** subject → GridIR（立体経路、破綻時は②の画像で平面フォールバック）。 */
export async function resolveCharacterGrid(subject: string, targetHeight?: number): Promise<ResolveResult> {
  // サイズ無指定なら設定の既定高さを使う（env DEFAULT_CHARACTER_HEIGHT で調整可）。
  const height = targetHeight ?? config.characterHeight;
  // キャッシュ命中：同じ subject の生成3Dが既にあれば、画像検索/Meshy を介さず再利用（数秒）。
  // ④⑤⑥は決定論なので、glb さえあれば同じ立体が即建つ。破損していたら下の再生成に落ちる。
  const cached = glbPathFor(subject);
  if (existsSync(cached)) {
    try {
      const ir = await time("gridFromGlb", () => gridFromGlb(cached, height), { mode: "cache-hit" });
      log.info("キャッシュ命中：生成3Dを再利用（画像検索/Meshy をスキップ）", { glb: cached });
      return { ok: true, ir, mode: "3d" };
    } catch (e) {
      log.warn("キャッシュ glb の再利用に失敗、通常生成へ", String(e));
    }
  }

  const image = await time("acquireImage", () => acquireImage(subject)); // ②（失敗＝平面も不可）
  if (!image) return { ok: false, error: "参照画像を取得できませんでした" };

  try {
    if (!config.meshyApiKey.trim()) throw new Error("MESHY_API_KEY 未設定");
    const glb = await time("generate3D", () => generate3D(image.path, slug(subject))); // ③ ★原則破り★
    const ir = await time("gridFromGlb", () => gridFromGlb(glb, height), { mode: "3d" });
    return { ok: true, ir, mode: "3d" };
  } catch (e) {
    log.warn("立体生成に失敗、平面フォールバックへ", String(e));
    try {
      const flat = await time("imageToGridIR", () => imageToGridIR(image.path, { target: height, thickness: 2 }), { mode: "flat" }); // v3.0 決定論
      return { ok: true, ir: flat, mode: "flat" };
    } catch (e2) {
      return { ok: false, error: `平面フォールバックも失敗: ${String(e2)}` };
    }
  }
}
