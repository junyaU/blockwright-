import { describe, it, expect } from "vitest";
import { parseIR, SIZE_MAX, FOOTPRINT_MAX, FOOTPRINT_MIN, HEIGHT_MAX } from "./ir.js";

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
    expect(r.ok && r.ir.type === "box" && r.ir.hollow).toBe(true);
  });

  it("範囲外サイズはクランプし警告を出す（落ちない）", () => {
    const r = parseIR({ type: "box", size: { w: 999, d: 0, h: 3.7 }, material: "stone" });
    expect(r.ok).toBe(true);
    if (r.ok && r.ir.type === "box") {
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

describe("parseIR house (FR-13/FR-25)", () => {
  it("妥当な house を受理し、既定（roof=gable維持/facing=auto）を埋める", () => {
    const r = parseIR({ type: "house", footprint: { w: 9, d: 7 }, height: 5, roof: "flat", style: "stone" });
    expect(r.ok).toBe(true);
    if (r.ok && r.ir.type === "house") {
      expect(r.ir.footprint).toEqual({ w: 9, d: 7 });
      expect(r.ir.roof).toBe("flat");
      expect(r.ir.facing).toBe("auto");
      expect(r.ir.style).toBe("stone");
    }
  });

  it("footprint/height/overhang を範囲にクランプする", () => {
    const r = parseIR({
      type: "house",
      footprint: { w: 99, d: 2 },
      height: 999,
      roof: "gable",
      roofOverhang: 9,
    });
    expect(r.ok).toBe(true);
    if (r.ok && r.ir.type === "house") {
      expect(r.ir.footprint).toEqual({ w: FOOTPRINT_MAX, d: FOOTPRINT_MIN });
      expect(r.ir.height).toBe(HEIGHT_MAX);
      expect(r.ir.roofOverhang).toBe(2);
      expect(r.warnings.length).toBeGreaterThan(0);
    }
  });

  it("door.position 数値は 1..w-2 にクランプする", () => {
    const r = parseIR({ type: "house", footprint: { w: 7, d: 7 }, height: 4, roof: "flat", door: { position: 99 } });
    expect(r.ok && r.ir.type === "house" && r.ir.door?.position).toBe(5); // w-2 = 5
  });

  it("roof 不正・facing 不正は既定にフォールバックする", () => {
    const r = parseIR({ type: "house", footprint: { w: 6, d: 6 }, height: 4, roof: "weird", facing: "up" });
    expect(r.ok).toBe(true);
    if (r.ok && r.ir.type === "house") {
      expect(r.ir.roof).toBe("gable");
      expect(r.ir.facing).toBe("auto");
    }
  });

  it("footprint が無い house は拒否する", () => {
    expect(parseIR({ type: "house", height: 4, roof: "flat" }).ok).toBe(false);
  });
});
