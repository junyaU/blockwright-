import { describe, it, expect } from "vitest";
import { qualityGate } from "./gate.js";
import type { GridIR } from "../ir.js";

/** w×h×d の空 grid を作る。 */
function emptyGrid(w: number, h: number, d: number): GridIR {
  const voxels = Array.from({ length: h }, () => Array.from({ length: d }, () => new Array<number>(w).fill(0)));
  return { type: "grid", size: { w, h, d }, voxels, palette: { 1: "minecraft:stone" }, facing: "auto" };
}

/** [x0,x1]×[y0,y1]×[z0,z1] を idx で埋める。 */
function fill(ir: GridIR, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, idx = 1): void {
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) ir.voxels[y]![z]![x] = idx;
}

describe("qualityGate", () => {
  it("健全な塊（中央充填）は合格", () => {
    const ir = emptyGrid(8, 8, 8);
    fill(ir, 1, 6, 1, 6, 1, 6); // 6^3=216 / 512 ≈ 0.42、連結、min次元8
    const r = qualityGate(ir);
    expect(r.ok).toBe(true);
  });

  it("ほぼ空は不合格", () => {
    const ir = emptyGrid(8, 8, 8);
    fill(ir, 0, 0, 0, 0, 0, 0); // 1/512
    const r = qualityGate(ir);
    expect(r.ok).toBe(false);
    expect(r.reasons.join()).toMatch(/低すぎ/);
  });

  it("全 solid（塊化）は不合格", () => {
    const ir = emptyGrid(6, 6, 6);
    fill(ir, 0, 5, 0, 5, 0, 5); // 100%
    const r = qualityGate(ir);
    expect(r.ok).toBe(false);
    expect(r.reasons.join()).toMatch(/塊化/);
  });

  it("退化（板状・最小次元1）は不合格", () => {
    const ir = emptyGrid(8, 1, 8);
    fill(ir, 1, 6, 0, 0, 1, 6);
    const r = qualityGate(ir);
    expect(r.ok).toBe(false);
    expect(r.reasons.join()).toMatch(/退化/);
  });

  it("分離した等サイズ破片2つは不合格（連結成分比0.5）", () => {
    const ir = emptyGrid(8, 8, 8);
    fill(ir, 0, 1, 0, 1, 0, 1); // 塊A 8
    fill(ir, 6, 7, 6, 7, 6, 7); // 塊B 8（分離）
    const r = qualityGate(ir);
    expect(r.ok).toBe(false);
    expect(r.reasons.join()).toMatch(/破片/);
  });
});
