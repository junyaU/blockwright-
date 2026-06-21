/**
 * §6.3 C3: buildHouse(ir, origin) ★v1 中核★。
 *
 * 全形状を **ローカル空間**（lx∈[0,w-1], lz∈[0,d-1], ly∈[0,屋根頂]、正面壁=lz=0）で
 * `LocalOp[]` として積み、最後に geometry.transformHouse で facing 回転＋ワールド化する。
 * 幾何ロジックを facing から独立させ、AI には座標を一切委ねない。
 *
 * 施工順（後工程が前工程を上書きして開口を作る）：
 *   床 → 四方の壁 → トリム(隅柱) → ドア開口(air) → 窓 → 屋根 → gable妻壁埋め
 */
import type { HouseIR, Vec3, BuildResult, Facing, Palette } from "./ir.js";
import { resolvePalette } from "./palette.js";
import { transformHouse, type LocalOp } from "./geometry.js";
import { log } from "./log.js";

const AIR = "minecraft:air";

function fillOp(
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  material: string,
): LocalOp {
  return {
    kind: "fill",
    min: { x: Math.min(x0, x1), y: Math.min(y0, y1), z: Math.min(z0, z1) },
    max: { x: Math.max(x0, x1), y: Math.max(y0, y1), z: Math.max(z0, z1) },
    material,
  };
}

/** ly=0 の床全面。 */
function floor(ops: LocalOp[], w: number, d: number, material: string): void {
  ops.push(fillOp(0, 0, 0, w - 1, 0, d - 1, material));
}

/** ly∈[1,h] の四方の壁（内部 air・天井なし）。 */
function walls(ops: LocalOp[], w: number, d: number, h: number, material: string): void {
  ops.push(fillOp(0, 1, 0, w - 1, h, 0, material)); // 北 lz=0（正面）
  ops.push(fillOp(0, 1, d - 1, w - 1, h, d - 1, material)); // 南 lz=d-1
  ops.push(fillOp(0, 1, 0, 0, h, d - 1, material)); // 西 lx=0
  ops.push(fillOp(w - 1, 1, 0, w - 1, h, d - 1, material)); // 東 lx=w-1
}

/** 4 隅の垂直柱（トリム）。trim==wall なら見た目変化なし。 */
function corners(ops: LocalOp[], w: number, d: number, h: number, material: string): void {
  ops.push(fillOp(0, 1, 0, 0, h, 0, material));
  ops.push(fillOp(w - 1, 1, 0, w - 1, h, 0, material));
  ops.push(fillOp(0, 1, d - 1, 0, h, d - 1, material));
  ops.push(fillOp(w - 1, 1, d - 1, w - 1, h, d - 1, material));
}

/** 正面壁 lz=0 の doorX 位置に幅1×高2の air 開口（実ドアは置かない＝§4.2）。 */
function carveDoor(ops: LocalOp[], doorX: number): void {
  ops.push(fillOp(doorX, 1, 0, doorX, 2, 0, AIR));
}

function doorXOf(ir: HouseIR, w: number): number {
  const pos = ir.door?.position;
  if (typeof pos === "number") return Math.min(w - 2, Math.max(1, pos));
  return Math.floor((w - 1) / 2); // center
}

/** [lo,hi] に n 個の整数位置を等間隔配置（重複は除去）。 */
function evenPositions(lo: number, hi: number, n: number): number[] {
  if (n <= 0 || hi < lo) return [];
  if (n === 1) return [Math.round((lo + hi) / 2)];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.round(lo + ((hi - lo) * i) / (n - 1)));
  return [...new Set(out)];
}

/** 等間隔の窓（1×1）。四方の壁に配置し、正面はドアと衝突する位置を除く（FR-19/R5）。 */
function placeWindows(ops: LocalOp[], w: number, d: number, h: number, ir: HouseIR, doorX: number, material: string): void {
  const sill = ir.windows?.sill ?? 1;
  const wy = Math.min(h, Math.max(1, 1 + sill));

  // x 方向の壁（正面 lz=0・背面 lz=d-1）
  const xLo = 1, xHi = w - 2;
  const nx = ir.windows?.count ?? Math.max(1, Math.floor((xHi - xLo) / 2) + 1);
  for (const x of evenPositions(xLo, xHi, nx)) {
    if (x !== doorX) ops.push({ kind: "point", pos: { x, y: wy, z: 0 }, material }); // 正面
    ops.push({ kind: "point", pos: { x, y: wy, z: d - 1 }, material }); // 背面
  }

  // z 方向の壁（西 lx=0・東 lx=w-1）
  const zLo = 1, zHi = d - 2;
  const nz = ir.windows?.count ?? Math.max(1, Math.floor((zHi - zLo) / 2) + 1);
  for (const z of evenPositions(zLo, zHi, nz)) {
    ops.push({ kind: "point", pos: { x: 0, y: wy, z }, material });
    ops.push({ kind: "point", pos: { x: w - 1, y: wy, z }, material });
  }
}

/** 平屋根：ly=h+1 に footprint（overhang 拡張）を1層。 */
function flatRoof(ops: LocalOp[], w: number, d: number, h: number, ov: number, material: string): void {
  ops.push(fillOp(-ov, h + 1, -ov, w - 1 + ov, h + 1, d - 1 + ov, material));
}

/**
 * 切妻屋根（階段状）。棟＝長辺方向。gable 妻壁の三角隙間も wall で塞ぐ（FR-22/R4）。
 * overhang は棟方向（長辺）に拡張する。
 */
function gableRoof(ops: LocalOp[], w: number, d: number, h: number, ov: number, roofMat: string, wallMat: string): void {
  if (w >= d) {
    // 棟=X方向、勾配=Z方向
    const half = Math.floor((d - 1) / 2);
    for (let k = 0; k <= half; k++) {
      const y = h + 1 + k;
      const zLo = k, zHi = d - 1 - k;
      ops.push(fillOp(-ov, y, zLo, w - 1 + ov, y, zLo, roofMat));
      if (zHi !== zLo) ops.push(fillOp(-ov, y, zHi, w - 1 + ov, y, zHi, roofMat));
      if (k >= 1 && zLo + 1 <= zHi - 1) {
        // 妻壁：端壁 lx=0 / lx=w-1 の三角隙間を埋める
        ops.push(fillOp(0, y, zLo + 1, 0, y, zHi - 1, wallMat));
        ops.push(fillOp(w - 1, y, zLo + 1, w - 1, y, zHi - 1, wallMat));
      }
    }
  } else {
    // 棟=Z方向、勾配=X方向
    const half = Math.floor((w - 1) / 2);
    for (let k = 0; k <= half; k++) {
      const y = h + 1 + k;
      const xLo = k, xHi = w - 1 - k;
      ops.push(fillOp(xLo, y, -ov, xLo, y, d - 1 + ov, roofMat));
      if (xHi !== xLo) ops.push(fillOp(xHi, y, -ov, xHi, y, d - 1 + ov, roofMat));
      if (k >= 1 && xLo + 1 <= xHi - 1) {
        ops.push(fillOp(xLo + 1, y, 0, xHi - 1, y, 0, wallMat));
        ops.push(fillOp(xLo + 1, y, d - 1, xHi - 1, y, d - 1, wallMat));
      }
    }
  }
}

export function buildHouse(ir: HouseIR, origin: Vec3): BuildResult {
  const { palette, warnings } = resolvePalette(ir);
  for (const wmsg of warnings) log.warn("palette解決", wmsg);
  log.info("解決palette", palette);

  const facing: Facing = ir.facing && ir.facing !== "auto" ? ir.facing : "south";
  const w = ir.footprint.w;
  const d = ir.footprint.d;
  const h = ir.height;
  const ov = ir.roofOverhang ?? 1;
  const pal: Palette = palette;
  const trim = pal.trim ?? pal.wall;
  const windowMat = pal.window ?? "minecraft:glass";

  const ops: LocalOp[] = [];
  floor(ops, w, d, pal.floor);
  walls(ops, w, d, h, pal.wall);
  corners(ops, w, d, h, trim);

  const doorX = doorXOf(ir, w);
  carveDoor(ops, doorX);

  if ((ir.windows?.pattern ?? "even") === "even") {
    placeWindows(ops, w, d, h, ir, doorX, windowMat);
  }

  if (ir.roof === "flat") flatRoof(ops, w, d, h, ov, pal.roof);
  else gableRoof(ops, w, d, h, ov, pal.roof, pal.wall);

  log.info("house facing/寸法", { facing, w, d, h, roof: ir.roof, ov });
  return transformHouse(ops, facing, origin, w, d);
}
