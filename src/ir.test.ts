import { describe, it, expect } from "vitest";
import { parseIR, SIZE_MAX } from "./ir.js";

describe("parseIR (FR-06)", () => {
  it("妥当な box を受理する", () => {
    const r = parseIR({ type: "box", size: { w: 5, d: 4, h: 3 }, material: "minecraft:oak_planks" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ir).toEqual({
        type: "box",
        size: { w: 5, d: 4, h: 3 },
        material: "minecraft:oak_planks",
        hollow: false,
      });
      expect(r.warnings).toHaveLength(0);
    }
  });

  it("hollow を真偽値として保持し、省略時は false", () => {
    const r = parseIR({ type: "box", size: { w: 2, d: 2, h: 2 }, material: "x", hollow: true });
    expect(r.ok && r.ir.hollow).toBe(true);
  });

  it("範囲外サイズはクランプし警告を出す（落ちない）", () => {
    const r = parseIR({ type: "box", size: { w: 999, d: 0, h: 3.7 }, material: "stone" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ir.size).toEqual({ w: SIZE_MAX, d: 1, h: 4 });
      expect(r.warnings.length).toBeGreaterThan(0);
    }
  });

  it("box 以外の type は拒否する", () => {
    expect(parseIR({ type: "grid", size: { w: 1, d: 1, h: 1 }, material: "x" }).ok).toBe(false);
  });

  it("material が無い/空なら拒否する", () => {
    expect(parseIR({ type: "box", size: { w: 1, d: 1, h: 1 } }).ok).toBe(false);
    expect(parseIR({ type: "box", size: { w: 1, d: 1, h: 1 }, material: "  " }).ok).toBe(false);
  });

  it("size が数値でなければ拒否する", () => {
    expect(parseIR({ type: "box", size: { w: "5", d: 1, h: 1 }, material: "x" }).ok).toBe(false);
  });

  it("オブジェクトでない入力でも落ちずに失敗を返す", () => {
    expect(parseIR(null).ok).toBe(false);
    expect(parseIR("oops").ok).toBe(false);
  });
});
