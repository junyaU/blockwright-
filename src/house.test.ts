import { describe, it, expect } from "vitest";
import { buildHouse } from "./house.js";
import type { HouseIR, Vec3 } from "./ir.js";

const ORIGIN: Vec3 = { x: 0, y: 64, z: 0 };
// facing "north" + ORIGIN で、local (lx,ly,lz) → world (lx, 64+ly, lz)（オフセット無し）。

function house(overrides: Partial<HouseIR>): HouseIR {
  return {
    type: "house",
    footprint: { w: 7, d: 7 },
    height: 4,
    roof: "flat",
    roofOverhang: 0,
    facing: "north",
    style: "stone",
    windows: { pattern: "none" },
    ...overrides,
  };
}

/** "fill x0 y0 z0 x1 y1 z1 mat" → 数値6 + mat。 */
function parseFill(cmd: string): { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; mat: string } | null {
  const m = cmd.match(/^fill (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (\S+)/);
  if (!m) return null;
  const n = m.slice(1, 7).map(Number) as number[];
  return { x0: n[0]!, y0: n[1]!, z0: n[2]!, x1: n[3]!, y1: n[4]!, z1: n[5]!, mat: m[7]! };
}

/** ワールド点 (x,y,z) を覆う fill が commands にあるか。 */
function covered(commands: string[], x: number, y: number, z: number, mat?: string): boolean {
  return commands.some((c) => {
    const f = parseFill(c);
    if (!f) {
      const s = c.match(/^setblock (-?\d+) (-?\d+) (-?\d+) (\S+)/);
      if (!s) return false;
      return Number(s[1]) === x && Number(s[2]) === y && Number(s[3]) === z && (!mat || s[4] === mat);
    }
    return (
      x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1 && z >= f.z0 && z <= f.z1 && (!mat || f.mat === mat)
    );
  });
}

describe("buildHouse 躯体 (FR-17/18)", () => {
  it("床・四方の壁・正面ドア開口がある", () => {
    const { commands } = buildHouse(house({}), ORIGIN);
    // 床 ly=0 → world y=64
    expect(covered(commands, 5, 64, 5, "minecraft:stone")).toBe(true);
    // 正面壁 lz=0 → world z=0、ly=1..h（stone style wall=stone_bricks）
    expect(covered(commands, 3, 66, 0, "minecraft:stone_bricks")).toBe(true);
    // ドア開口：w=7 → doorX=3 → world x=3、正面 z=0、ly=1,2 → y=65,66 が air
    expect(covered(commands, 3, 65, 0, "minecraft:air")).toBe(true);
    expect(covered(commands, 3, 66, 0, "minecraft:air")).toBe(true);
  });
});

describe("buildHouse 窓 (FR-19)", () => {
  it("窓が配置され、正面ドア列には窓が無い", () => {
    const { commands } = buildHouse(house({ windows: { pattern: "even", sill: 1 } }), ORIGIN);
    const windows = commands.filter((c) => c.includes("minecraft:glass"));
    expect(windows.length).toBeGreaterThan(0);
    // ドア列(world x=3, 正面 z=0)に窓(glass)が無いこと
    expect(covered(commands, 3, 66, 0, "minecraft:glass")).toBe(false);
  });
});

describe("buildHouse flat 屋根 (FR-20)", () => {
  it("ly=h+1（world y=69）に屋根層がある", () => {
    const { commands, region } = buildHouse(house({ roof: "flat" }), ORIGIN);
    expect(covered(commands, 5, 69, 5, "minecraft:cobblestone")).toBe(true); // stone roof=cobblestone
    expect(region.max.y).toBeGreaterThanOrEqual(69);
  });
});

describe("buildHouse gable 屋根 (FR-21/22/R3)", () => {
  it("奇数 d は頂部が幅1で閉じ、妻壁に穴が無い", () => {
    // w=7,d=7,h=4。half=3。頂部 y=h+1+3=8（world）、ridge lz=3 → world z=5。
    const { commands, region } = buildHouse(house({ roof: "gable", windows: { pattern: "none" } }), ORIGIN);
    // 頂部 ridge（lz=3 → world z=3, y=64+8=72）が屋根で覆われる
    expect(covered(commands, 3, 72, 3, "minecraft:cobblestone")).toBe(true);
    // ridge より上に何も無い（region.max.y は 72）
    expect(region.max.y).toBe(72);
    // 妻壁の埋め（k=1, y=64+6=70, lx=0→world x=0, lz∈[2,4]→world z∈[2,4]）に wall がある
    expect(covered(commands, 0, 70, 3, "minecraft:stone_bricks")).toBe(true);
  });

  it("偶数 d は頂部が幅2でも破綻しない", () => {
    const { commands } = buildHouse(house({ footprint: { w: 8, d: 6 }, roof: "gable" }), ORIGIN);
    // half=floor(5/2)=2、頂部 y=64+4+1+2=71、ridge lz=2,3 → world z=2,3
    expect(covered(commands, 4, 71, 2, "minecraft:cobblestone")).toBe(true);
    expect(covered(commands, 4, 71, 3, "minecraft:cobblestone")).toBe(true);
  });
});

describe("buildHouse region / overhang (FR-26)", () => {
  it("region が overhang を含む（負側にも広がる）", () => {
    const { region } = buildHouse(house({ roof: "flat", roofOverhang: 2 }), ORIGIN);
    // overhang2 で屋根は local -2..w+1 → world では PLACEMENT_OFFSET 2 + (-2)=0 まで
    expect(region.min.x).toBeLessThanOrEqual(0);
    expect(region.min.z).toBeLessThanOrEqual(0);
  });
});
