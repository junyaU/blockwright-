/**
 * §v2 C3: buildTower(ir, origin)。塔（角形）の決定論生成。
 *
 * house と同じく全形状を **ローカル空間**（lx∈[0,w-1], lz∈[0,d-1], ly∈[0,cap頂]、正面壁=lz=0）で
 * `LocalOp[]` として積み、最後に geometry.transformBuilding で facing 回転＋ワールド化する。
 * 躯体（床/四方壁/隅柱/ドア開口/等間隔配置）は house.ts のプリミティブを共用し、
 * tower 固有なのは「縦スリット窓」と「上部処理（flat cap / battlement 胸壁）」のみ。
 *
 * 施工順（後工程が前工程を上書きして開口を作る）：
 *   床 → 四方の壁 → 隅柱(trim) → ドア開口(air) → 縦スリット → cap
 */
import type { TowerIR, Vec3, BuildResult } from "./ir.js";
import { resolvePaletteLogged } from "./palette.js";
import { transformBuilding, resolveFacing, type LocalOp } from "./geometry.js";
import { fillOp, floor, walls, corners, carveDoor, doorXOf, evenPositions } from "./house.js";
import { log } from "./log.js";

/**
 * 縦スリット窓（狭間）。各面に幅1の縦長 glass を等間隔配置する。
 * 正面 lz=0 は doorX 列を除外（R5 ドア衝突回避）。house の placeWindows を縦長化したもの。
 */
function placeSlits(
  ops: LocalOp[], w: number, d: number, h: number,
  ir: TowerIR, doorX: number, material: string,
): void {
  const sill = ir.windows?.sill ?? 2;
  const span = ir.windows?.span ?? 3;
  const yLo = Math.min(h, Math.max(1, 1 + sill));
  const yHi = Math.min(h, Math.max(yLo, yLo + span - 1));

  // x 方向の壁（正面 lz=0・背面 lz=d-1）
  const xLo = 1, xHi = w - 2;
  const nx = ir.windows?.count ?? Math.max(1, Math.floor((xHi - xLo) / 2) + 1);
  for (const x of evenPositions(xLo, xHi, nx)) {
    if (x !== doorX) ops.push(fillOp(x, yLo, 0, x, yHi, 0, material)); // 正面
    ops.push(fillOp(x, yLo, d - 1, x, yHi, d - 1, material)); // 背面
  }

  // z 方向の壁（西 lx=0・東 lx=w-1）
  const zLo = 1, zHi = d - 2;
  const nz = ir.windows?.count ?? Math.max(1, Math.floor((zHi - zLo) / 2) + 1);
  for (const z of evenPositions(zLo, zHi, nz)) {
    ops.push(fillOp(0, yLo, z, 0, yHi, z, material));
    ops.push(fillOp(w - 1, yLo, z, w - 1, yHi, z, material));
  }
}

/** 平天井で蓋（ly=h+1 に footprint 1 層）。塔上部を閉じる。 */
function flatCap(ops: LocalOp[], w: number, d: number, h: number, material: string): void {
  ops.push(fillOp(0, h + 1, 0, w - 1, h + 1, d - 1, material));
}

/** 外周セル（lx∈{0,w-1} または lz∈{0,d-1}）を列挙する。 */
function perimeterCells(w: number, d: number): { x: number; z: number }[] {
  const seen = new Set<string>();
  const cells: { x: number; z: number }[] = [];
  const add = (x: number, z: number): void => {
    const k = `${x},${z}`;
    if (seen.has(k)) return;
    seen.add(k);
    cells.push({ x, z });
  };
  for (let x = 0; x < w; x++) {
    add(x, 0);
    add(x, d - 1);
  }
  for (let z = 0; z < d; z++) {
    add(0, z);
    add(w - 1, z);
  }
  return cells;
}

/**
 * 胸壁（battlement）：ly=h+1 に外周リング（屋上の歩廊＝土台）、その上 ly=h+2 に
 * 外周セルを 1 つおきに merlon として point で立てる。四隅は必ず立て、頂点欠けを防ぐ。
 * merlon は point なので回転 min/max 問題（R2）の対象外。
 */
function battlementCap(
  ops: LocalOp[], w: number, d: number, h: number, capMat: string, merlonMat: string,
): void {
  // ly=h+1：外周リング（4 辺）を capMat で。内側は開いた屋上のまま。
  ops.push(fillOp(0, h + 1, 0, w - 1, h + 1, 0, capMat)); // z=0
  ops.push(fillOp(0, h + 1, d - 1, w - 1, h + 1, d - 1, capMat)); // z=d-1
  ops.push(fillOp(0, h + 1, 0, 0, h + 1, d - 1, capMat)); // x=0
  ops.push(fillOp(w - 1, h + 1, 0, w - 1, h + 1, d - 1, capMat)); // x=w-1

  // ly=h+2：merlon を 1 つおきに。隣接外周セルは (x+z) のパリティが交互になる。
  const isCorner = (x: number, z: number): boolean =>
    (x === 0 || x === w - 1) && (z === 0 || z === d - 1);
  for (const c of perimeterCells(w, d)) {
    if ((c.x + c.z) % 2 === 0 || isCorner(c.x, c.z)) {
      ops.push({ kind: "point", pos: { x: c.x, y: h + 2, z: c.z }, material: merlonMat });
    }
  }
}

export function buildTower(ir: TowerIR, origin: Vec3): BuildResult {
  // tower は石造が自然なので style 未指定時は "stone" を既定にする（palette 指定があればそちら優先）。
  const pal = resolvePaletteLogged({ palette: ir.palette, style: ir.style ?? "stone" });
  const facing = resolveFacing(ir.facing, "south");
  const w = ir.footprint.w;
  const d = ir.footprint.d;
  const h = ir.height;
  const trim = pal.trim ?? pal.wall;
  const slitMat = pal.window ?? "minecraft:glass";
  const capMat = pal.roof;
  const cap = ir.cap ?? "battlement";

  const ops: LocalOp[] = [];
  floor(ops, w, d, pal.floor);
  walls(ops, w, d, h, pal.wall);
  corners(ops, w, d, h, trim);

  const doorX = doorXOf(ir, w);
  carveDoor(ops, doorX);

  if ((ir.windows?.pattern ?? "slit") === "slit") {
    placeSlits(ops, w, d, h, ir, doorX, slitMat);
  }

  if (cap === "flat") flatCap(ops, w, d, h, capMat);
  else battlementCap(ops, w, d, h, capMat, trim);

  log.info("tower facing/寸法", { facing, w, d, h, cap });
  return transformBuilding(ops, facing, origin, w, d);
}
