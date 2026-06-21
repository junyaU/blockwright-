/**
 * §v2 C3: buildWall(ir, origin)。防壁（直線状の壁）の決定論生成。
 *
 * house/tower と同じくローカル空間（lx∈[0,length-1]=長辺, lz∈[0,thickness-1]=厚み, ly=高さ、
 * 正面=lz=0）で `LocalOp[]` を積み、最後に transformBuilding でワールド化する。
 * 構成：壁本体スラブ → 通用門開口(air) → 上部胸壁(crenellation)。
 */
import type { WallIR, Vec3, BuildResult, Facing, Palette } from "./ir.js";
import { resolvePalette } from "./palette.js";
import { transformBuilding, type LocalOp } from "./geometry.js";
import { fillOp } from "./house.js";
import { log } from "./log.js";

const AIR = "minecraft:air";

/** 壁本体：ly∈[1,h] の厚み thickness のソリッドスラブ。 */
function wallBody(ops: LocalOp[], length: number, thickness: number, h: number, material: string): void {
  ops.push(fillOp(0, 1, 0, length - 1, h, thickness - 1, material));
}

/** 通用門：position を中心に幅 gw×高 gh の air を厚み全体に開口する。 */
function carveGate(ops: LocalOp[], ir: WallIR, length: number, thickness: number, h: number): void {
  if (!ir.gate) return;
  const pos = ir.gate.position === "center" || ir.gate.position === undefined
    ? Math.floor((length - 1) / 2)
    : ir.gate.position;
  const gw = ir.gate.width ?? 1;
  const gh = Math.min(h, ir.gate.height ?? Math.min(3, h));
  const left = Math.max(0, pos - Math.floor((gw - 1) / 2));
  const right = Math.min(length - 1, left + gw - 1);
  ops.push(fillOp(left, 1, 0, right, gh, thickness - 1, AIR));
}

/** 胸壁：ly=h+1 に長辺方向 1 つおきに merlon を厚み全体で立てる。 */
function crenellate(ops: LocalOp[], length: number, thickness: number, h: number, material: string): void {
  for (let x = 0; x < length; x++) {
    if (x % 2 === 0) ops.push(fillOp(x, h + 1, 0, x, h + 1, thickness - 1, material));
  }
}

export function buildWall(ir: WallIR, origin: Vec3): BuildResult {
  // 防壁は石造が自然なので style 未指定時は "stone" を既定にする（palette 指定があればそちら優先）。
  const { palette, warnings } = resolvePalette({ palette: ir.palette, style: ir.style ?? "stone" });
  for (const wmsg of warnings) log.warn("palette解決", wmsg);
  log.info("解決palette", palette);

  const facing: Facing = ir.facing && ir.facing !== "auto" ? ir.facing : "south";
  const length = ir.length;
  const thickness = ir.thickness ?? 1;
  const h = ir.height;
  const pal: Palette = palette;
  const merlonMat = pal.trim ?? pal.wall;

  const ops: LocalOp[] = [];
  wallBody(ops, length, thickness, h, pal.wall);
  carveGate(ops, ir, length, thickness, h);
  if (ir.crenellation !== false) crenellate(ops, length, thickness, h, merlonMat);

  log.info("wall facing/寸法", { facing, length, thickness, h, crenellation: ir.crenellation !== false });
  return transformBuilding(ops, facing, origin, length, thickness);
}
