/**
 * §v2 C3: buildBridge(ir, origin)。橋（桁＋欄干＋橋脚）の決定論生成。
 *
 * house/tower と同じくローカル空間（lx∈[0,span-1]=長辺, lz∈[0,width-1]=幅, deck=ly=0、
 * 正面=lz=0）で `LocalOp[]` を積み、最後に transformBuilding でワールド化する。
 * 橋脚は ly<0 へ降ろす（origin.y=プレイヤー足元基準）。
 * 構成：桁(deck) → 両側の欄干(railing) → （任意）橋脚(piers)。
 */
import type { BridgeIR, Vec3, BuildResult } from "./ir.js";
import { BRIDGE_PIER_DEPTH } from "./ir.js";
import { resolvePaletteLogged } from "./palette.js";
import { transformBuilding, resolveFacing, type LocalOp } from "./geometry.js";
import { fillOp, evenPositions } from "./house.js";
import { log } from "./log.js";

/** 桁（deck）：ly=0 の span×width 平面。 */
function deck(ops: LocalOp[], span: number, width: number, material: string): void {
  ops.push(fillOp(0, 0, 0, span - 1, 0, width - 1, material));
}

/** 欄干：両側の縁（lz=0, lz=width-1）に ly=1 の 1 段。 */
function railings(ops: LocalOp[], span: number, width: number, material: string): void {
  ops.push(fillOp(0, 1, 0, span - 1, 1, 0, material));
  ops.push(fillOp(0, 1, width - 1, span - 1, 1, width - 1, material));
}

/** 橋脚：両側の縁に沿って、等間隔で ly=-1..-depth の支柱を降ろす。 */
function piers(ops: LocalOp[], span: number, width: number, depth: number, material: string): void {
  const n = Math.max(2, Math.floor(span / 10) + 1);
  for (const x of evenPositions(0, span - 1, n)) {
    ops.push(fillOp(x, -depth, 0, x, -1, 0, material));
    ops.push(fillOp(x, -depth, width - 1, x, -1, width - 1, material));
  }
}

export function buildBridge(ir: BridgeIR, origin: Vec3): BuildResult {
  // 橋は石造が自然なので style 未指定時は "stone" を既定にする（palette 指定があればそちら優先）。
  const pal = resolvePaletteLogged({ palette: ir.palette, style: ir.style ?? "stone" });
  const facing = resolveFacing(ir.facing, "south");
  const span = ir.span;
  const width = ir.width;
  const pierMat = pal.trim ?? pal.wall;

  const ops: LocalOp[] = [];
  deck(ops, span, width, pal.floor);
  if (ir.railing !== false) railings(ops, span, width, pal.wall);
  if (ir.piers !== false) piers(ops, span, width, BRIDGE_PIER_DEPTH, pierMat);

  log.info("bridge facing/寸法", { facing, span, width, railing: ir.railing !== false, piers: ir.piers !== false });
  return transformBuilding(ops, facing, origin, span, width);
}
