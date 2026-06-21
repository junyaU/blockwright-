import { describe, it, expect } from "vitest";
import { resolveMaterial } from "./materials.js";
import { config } from "./config.js";

describe("resolveMaterial (FR-09)", () => {
  it("allowlist の素材はそのまま通す（警告なし）", () => {
    const r = resolveMaterial("minecraft:oak_planks");
    expect(r.material).toBe("minecraft:oak_planks");
    expect(r.warning).toBeUndefined();
  });

  it("namespace 無しでも解決する", () => {
    expect(resolveMaterial("oak_planks").material).toBe("minecraft:oak_planks");
  });

  it("JE→BE エイリアスを補正し警告を出す", () => {
    const r = resolveMaterial("grass");
    expect(r.material).toBe("minecraft:grass_block");
    expect(r.warning).toBeDefined();
  });

  it("未知だが形式が妥当な ID は信頼してそのまま使う（施工時に最終検証）", () => {
    // 実在ブロック（blue_glazed_terracotta 等）が allowlist 漏れでも通るように。
    const r = resolveMaterial("minecraft:blue_glazed_terracotta");
    expect(r.material).toBe("minecraft:blue_glazed_terracotta");
    expect(r.warning).toBeDefined(); // 未知の旨は警告に残す
  });

  it("形式が壊れた ID はフォールバックに置換する（例外を投げない）", () => {
    const r = resolveMaterial("minecraft:1 fake!!block");
    expect(r.material).toBe(config.fallbackMaterial);
    expect(r.warning).toBeDefined();
  });

  it("大文字や前後空白を正規化する", () => {
    expect(resolveMaterial("  Minecraft:Oak_Planks  ").material).toBe("minecraft:oak_planks");
  });
});
