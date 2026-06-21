/**
 * §v2.x C3: buildGrid(ir, origin)。dense voxel grid（自由形状の器）の決定論展開。
 *
 * voxels[y][z][x] を走査し、各非 0 セルを palette[index] のブロックに展開する。
 * index 0 は air として skip。per-voxel の setblock 量産は厳禁（R3）なので、
 * 各 (y,z) 行で同一 index の連続を 1 本の fill に畳む（X-run merge / FR-41）。
 * ローカル→ワールド変換・体積分割・回転 min/max 再計算は transformBuilding に委譲。
 */
import type { GridIR, Vec3, BuildResult, Facing } from "./ir.js";
import { resolveMaterial } from "./materials.js";
import { transformBuilding, toWorld, type LocalOp } from "./geometry.js";
import { fillOp } from "./house.js";
import { log } from "./log.js";

/** palette の各非 0 index を素材検証（不正形式はフォールバック＝穴を作らない／FR-43）。 */
function resolveGridPalette(ir: GridIR): { resolved: Record<number, string>; warnings: string[] } {
  const resolved: Record<number, string> = {};
  const warnings: string[] = [];
  for (const [k, id] of Object.entries(ir.palette)) {
    const idx = Number(k);
    const r = resolveMaterial(id);
    if (r.warning) warnings.push(`palette[${idx}]: ${r.warning}`);
    resolved[idx] = r.material;
  }
  return { resolved, warnings };
}

/** grid 全体（0..w-1, 0..h-1, 0..d-1）の 8 隅を変換して min/max を取る（§7.3 全体 AABB）。 */
function fullGridRegion(w: number, h: number, d: number, facing: Facing, origin: Vec3): { min: Vec3; max: Vec3 } {
  let min: Vec3 | null = null;
  let max: Vec3 | null = null;
  for (const lx of [0, w - 1]) {
    for (const ly of [0, h - 1]) {
      for (const lz of [0, d - 1]) {
        const p = toWorld({ x: lx, y: ly, z: lz }, facing, origin, w, d);
        if (min === null || max === null) {
          min = { ...p };
          max = { ...p };
        } else {
          min = { x: Math.min(min.x, p.x), y: Math.min(min.y, p.y), z: Math.min(min.z, p.z) };
          max = { x: Math.max(max.x, p.x), y: Math.max(max.y, p.y), z: Math.max(max.z, p.z) };
        }
      }
    }
  }
  return { min: min ?? { ...origin }, max: max ?? { ...origin } };
}

export function buildGrid(ir: GridIR, origin: Vec3): BuildResult {
  const facing: Facing = ir.facing && ir.facing !== "auto" ? ir.facing : "north";
  const { w, h, d } = ir.size;
  const { resolved, warnings } = resolveGridPalette(ir);
  for (const wmsg of warnings) log.warn("grid palette", wmsg);

  const ops: LocalOp[] = [];
  let nonAir = 0;
  for (let y = 0; y < h; y++) {
    for (let z = 0; z < d; z++) {
      const row = ir.voxels[y]![z]!;
      let x = 0;
      while (x < w) {
        const idx = row[x]!;
        if (idx === 0) {
          x++;
          continue;
        }
        // 同一 index の極大ランを 1 本の fill に畳む（X-run merge）。
        let x1 = x;
        while (x1 + 1 < w && row[x1 + 1] === idx) x1++;
        ops.push(fillOp(x, y, z, x1, y, z, resolved[idx]!));
        nonAir += x1 - x + 1;
        x = x1 + 1;
      }
    }
  }

  const { commands } = transformBuilding(ops, facing, origin, w, d);
  const region = fullGridRegion(w, h, d, facing, origin);

  log.info("grid 展開", { w, h, d, nonAir, fills: ops.length, commands: commands.length });
  return { region, commands };
}
