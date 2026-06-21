/**
 * §6.5 品質ゲート（破綻検知・決定論）。
 *
 * ⑤ボクセル化の結果 GridIR が「立体として妥当か」を判定し、破綻なら fallback（平面）へ。
 * 検知：ほぼ空 / ほぼ全 solid（塊化）/ AABB 退化（薄すぎ）/ 破片だらけ（連結成分比が低い）。
 * 閾値は定数で調整可能（R8）。
 */
import type { GridIR } from "../ir.js";

/** 占有率の下限（これ未満はほぼ空）。 */
export const MIN_FILL = 0.02;
/** 占有率の上限（これ超は塊化＝bbox 丸ごと solid）。 */
export const MAX_FILL = 0.985;
/** AABB の最小次元（これ未満は退化＝潰れ）。 */
export const MIN_DIM = 2;
/** 最大連結成分 / 全占有 の下限（これ未満は破片だらけ）。 */
export const MIN_LCC_RATIO = 0.6;

export interface GateResult {
  ok: boolean;
  reasons: string[];
  stats: { fill: number; minDim: number; lccRatio: number; nonAir: number };
}

/** 占有 voxel（!=0）の最大連結成分のサイズ（6 近傍）。 */
function largestVoxelComponent(ir: GridIR): { lcc: number; nonAir: number } {
  const { w, h, d } = ir.size;
  const occ = (x: number, y: number, z: number): boolean =>
    x >= 0 && x < w && y >= 0 && y < h && z >= 0 && z < d && ir.voxels[y]![z]![x] !== 0;

  const seen = new Set<number>();
  const idx = (x: number, y: number, z: number): number => (y * d + z) * w + x;
  let nonAir = 0;
  for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) if (occ(x, y, z)) nonAir++;

  let lcc = 0;
  const nb: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (let y = 0; y < h; y++) {
    for (let z = 0; z < d; z++) {
      for (let x = 0; x < w; x++) {
        if (!occ(x, y, z) || seen.has(idx(x, y, z))) continue;
        let size = 0;
        const stack: [number, number, number][] = [[x, y, z]];
        seen.add(idx(x, y, z));
        while (stack.length > 0) {
          const [cx, cy, cz] = stack.pop()!;
          size++;
          for (const [dx, dy, dz] of nb) {
            const nx = cx + dx, ny = cy + dy, nz = cz + dz;
            if (occ(nx, ny, nz) && !seen.has(idx(nx, ny, nz))) {
              seen.add(idx(nx, ny, nz));
              stack.push([nx, ny, nz]);
            }
          }
        }
        if (size > lcc) lcc = size;
      }
    }
  }
  return { lcc, nonAir };
}

/** GridIR が立体として妥当かを判定する。 */
export function qualityGate(ir: GridIR): GateResult {
  const { w, h, d } = ir.size;
  const total = w * h * d;
  const { lcc, nonAir } = largestVoxelComponent(ir);
  const fill = total > 0 ? nonAir / total : 0;
  const minDim = Math.min(w, h, d);
  const lccRatio = nonAir > 0 ? lcc / nonAir : 0;

  const reasons: string[] = [];
  if (fill < MIN_FILL) reasons.push(`占有率が低すぎる(${fill.toFixed(3)} < ${MIN_FILL})`);
  if (fill > MAX_FILL) reasons.push(`占有率が高すぎる＝塊化(${fill.toFixed(3)} > ${MAX_FILL})`);
  if (minDim < MIN_DIM) reasons.push(`AABB が退化(最小次元 ${minDim} < ${MIN_DIM})`);
  if (lccRatio < MIN_LCC_RATIO) reasons.push(`破片だらけ(連結成分比 ${lccRatio.toFixed(3)} < ${MIN_LCC_RATIO})`);

  return { ok: reasons.length === 0, reasons, stats: { fill, minDim, lccRatio, nonAir } };
}
