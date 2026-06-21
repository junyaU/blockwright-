import { describe, it, expect } from "vitest";
import { quantizeLab, PaletteBuilder, tableIds } from "./quantize.js";

describe("quantizeLab 最近傍 (FR-53)", () => {
  it("赤系は red 系ブロックへ", () => {
    expect(quantizeLab(190, 35, 35)).toMatch(/red/);
  });

  it("ピンク系は pink 系ブロックへ", () => {
    expect(quantizeLab(235, 140, 175)).toMatch(/pink/);
  });

  it("白系は white または quartz へ", () => {
    expect(quantizeLab(236, 238, 238)).toMatch(/white|quartz/);
  });

  it("ほぼ黒は black 系へ", () => {
    expect(quantizeLab(12, 13, 16)).toMatch(/black/);
  });

  it("濃紺（目の色）は青系（lapis/blue）へ", () => {
    expect(quantizeLab(30, 40, 90)).toMatch(/lapis|blue/);
  });
});

describe("代表色テーブルの健全性 (FR-54)", () => {
  it("全ブロックが minecraft 名前空間", () => {
    expect(tableIds().every((id) => id.startsWith("minecraft:"))).toBe(true);
  });

  it("重力・透過・部分ブロックを含まない", () => {
    const bad = /gravel|glass|_slab|_stairs|concrete_powder|leaves|^minecraft:sand$|^minecraft:ice$/;
    expect(tableIds().some((id) => bad.test(id))).toBe(false);
  });
});

describe("PaletteBuilder (FR-55)", () => {
  it("0 を予約し、新規は連番・既出は同 index", () => {
    const pb = new PaletteBuilder();
    const a = pb.intern("minecraft:red_wool");
    const b = pb.intern("minecraft:blue_wool");
    const a2 = pb.intern("minecraft:red_wool");
    expect(a).toBe(1);
    expect(b).toBe(2);
    expect(a2).toBe(1);
    const pal = pb.toPalette();
    expect(pal[0]).toBeUndefined();
    expect(pal[1]).toBe("minecraft:red_wool");
    expect(pal[2]).toBe("minecraft:blue_wool");
  });
});
