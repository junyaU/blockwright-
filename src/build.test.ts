import { describe, it, expect } from "vitest";
import { build, FILL_VOLUME_LIMIT } from "./build.js";
import type { BoxIR, Vec3 } from "./ir.js";

const ORIGIN: Vec3 = { x: 0, y: 64, z: 0 };
// build() は PLACEMENT_OFFSET {2,0,2} を足すので、最小角は (2,64,2)。

function volumeOf(cmd: string): number {
  // "fill x0 y0 z0 x1 y1 z1 material [hollow]" を解析して領域体積を返す。
  const n = cmd.split(/\s+/).slice(1, 7).map(Number);
  const [x0 = 0, y0 = 0, z0 = 0, x1 = 0, y1 = 0, z1 = 0] = n;
  return (
    (Math.abs(x1 - x0) + 1) * (Math.abs(y1 - y0) + 1) * (Math.abs(z1 - z0) + 1)
  );
}

describe("build box (FR-08)", () => {
  it("ソリッド箱を単一 fill に変換し region を返す", () => {
    const ir: BoxIR = { type: "box", size: { w: 5, d: 4, h: 3 }, material: "minecraft:oak_planks" };
    const res = build(ir, ORIGIN);
    expect(res.commands).toEqual(["fill 2 64 2 6 66 5 minecraft:oak_planks"]);
    expect(res.region).toEqual({ min: { x: 2, y: 64, z: 2 }, max: { x: 6, y: 66, z: 5 } });
  });

  it("hollow 箱は上限内なら hollow キーワードを使う", () => {
    const ir: BoxIR = { type: "box", size: { w: 5, d: 5, h: 5 }, material: "stone", hollow: true };
    const res = build(ir, ORIGIN);
    expect(res.commands).toEqual(["fill 2 64 2 6 68 6 minecraft:stone hollow"]);
  });

  it("未知でも形式が妥当な素材は信頼して使う（フォールバックは施工時=index 側）", () => {
    const ir: BoxIR = { type: "box", size: { w: 2, d: 2, h: 2 }, material: "blue_glazed_terracotta" };
    const res = build(ir, ORIGIN);
    expect(res.commands[0]).toContain("minecraft:blue_glazed_terracotta");
  });
});

describe("fill 体積上限の分割 (FR-10)", () => {
  it("ソリッドの巨大箱を複数 fill に分割し、各コマンドが上限以下", () => {
    const ir: BoxIR = { type: "box", size: { w: 64, d: 64, h: 64 }, material: "stone" };
    const res = build(ir, ORIGIN);
    expect(res.commands.length).toBeGreaterThan(1);
    for (const cmd of res.commands) {
      expect(volumeOf(cmd)).toBeLessThanOrEqual(FILL_VOLUME_LIMIT);
    }
  });

  it("上限超の hollow 箱は面分割し、hollow キーワードを使わず各コマンドが上限以下", () => {
    const ir: BoxIR = { type: "box", size: { w: 64, d: 64, h: 64 }, material: "stone", hollow: true };
    const res = build(ir, ORIGIN);
    for (const cmd of res.commands) {
      expect(cmd).not.toContain("hollow");
      expect(volumeOf(cmd)).toBeLessThanOrEqual(FILL_VOLUME_LIMIT);
    }
  });
});
