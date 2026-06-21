import { describe, it, expect } from "vitest";
import { resolvePalette, PRESETS, DEFAULT_STYLE } from "./palette.js";
import type { HouseIR } from "./ir.js";

function house(overrides: Partial<HouseIR>): HouseIR {
  return { type: "house", footprint: { w: 7, d: 7 }, height: 4, roof: "gable", ...overrides };
}

describe("resolvePalette (FR-15)", () => {
  it("style 名をプリセットに展開する", () => {
    const { palette } = resolvePalette(house({ style: "stone" }));
    expect(palette.wall).toBe(PRESETS.stone!.wall);
    expect(palette.floor).toBe(PRESETS.stone!.floor);
    expect(palette.roof).toBe(PRESETS.stone!.roof);
  });

  it("style/palette 無しなら既定 style を使う", () => {
    const { palette } = resolvePalette(house({}));
    expect(palette.wall).toBe(PRESETS[DEFAULT_STYLE]!.wall);
  });

  it("palette が style より優先され、欠けスロットは style で補完される", () => {
    const { palette } = resolvePalette(
      house({ style: "stone", palette: { wall: "minecraft:bricks", floor: "", roof: "" } }),
    );
    expect(palette.wall).toBe("minecraft:bricks"); // palette 優先
    expect(palette.floor).toBe(PRESETS.stone!.floor); // 欠けは style 補完
  });

  it("trim 未指定は wall、window 未指定は glass を充てる", () => {
    const { palette } = resolvePalette(
      house({ palette: { wall: "minecraft:bricks", floor: "minecraft:stone", roof: "minecraft:cobblestone" } }),
    );
    expect(palette.trim).toBe("minecraft:bricks"); // = wall
    expect(palette.window).toBe("minecraft:glass");
  });

  it("未知 style は警告を出して既定にフォールバックする", () => {
    const { palette, warnings } = resolvePalette(house({ style: "nonexistent" }));
    expect(palette.wall).toBe(PRESETS[DEFAULT_STYLE]!.wall);
    expect(warnings.some((w) => w.includes("nonexistent"))).toBe(true);
  });

  it("全スロットが namespaced な実体で埋まる", () => {
    const { palette } = resolvePalette(house({ style: "modern" }));
    for (const v of [palette.wall, palette.floor, palette.roof, palette.trim, palette.window]) {
      expect(v).toMatch(/^minecraft:[a-z0-9_]+$/);
    }
  });
});
