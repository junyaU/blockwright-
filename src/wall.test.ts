import { describe, it, expect } from "vitest";
import { buildWall } from "./wall.js";
import { parseIR } from "./ir.js";
import type { WallIR, Vec3 } from "./ir.js";

const ORIGIN: Vec3 = { x: 0, y: 64, z: 0 };
// facing "north" + ORIGIN で、local (lx,ly,lz) → world (lx, 64+ly, lz)。
// stone style: wall=stone_bricks, trim=chiseled_stone_bricks。

function wall(overrides: Partial<WallIR>): WallIR {
  return {
    type: "wall",
    length: 10,
    height: 5,
    thickness: 1,
    crenellation: true,
    facing: "north",
    style: "stone",
    ...overrides,
  };
}

function parseFill(cmd: string): { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; mat: string } | null {
  const m = cmd.match(/^fill (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (\S+)/);
  if (!m) return null;
  const n = m.slice(1, 7).map(Number) as number[];
  return { x0: n[0]!, y0: n[1]!, z0: n[2]!, x1: n[3]!, y1: n[4]!, z1: n[5]!, mat: m[7]! };
}

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

describe("buildWall 本体", () => {
  it("ly=1..h のソリッドスラブが壁素材で建つ", () => {
    const { commands, region } = buildWall(wall({}), ORIGIN);
    expect(covered(commands, 0, 65, 0, "minecraft:stone_bricks")).toBe(true);
    expect(covered(commands, 9, 69, 0, "minecraft:stone_bricks")).toBe(true);
    // 本体は ly=1..5 → world y=65..69
    expect(region.min.y).toBe(65);
  });
});

describe("buildWall 胸壁", () => {
  it("ly=h+1 に 1 つおきに merlon が立つ", () => {
    const { commands, region } = buildWall(wall({ crenellation: true }), ORIGIN);
    // ly=h+1=6 → world y=70。x=0,2,4... に merlon（trim）
    expect(covered(commands, 0, 70, 0, "minecraft:chiseled_stone_bricks")).toBe(true);
    expect(covered(commands, 2, 70, 0, "minecraft:chiseled_stone_bricks")).toBe(true);
    // x=1（奇数）には merlon 無し
    expect(covered(commands, 1, 70, 0)).toBe(false);
    expect(region.max.y).toBe(70);
  });

  it("crenellation:false なら上部に merlon が無い", () => {
    const { commands, region } = buildWall(wall({ crenellation: false }), ORIGIN);
    expect(covered(commands, 0, 70, 0)).toBe(false);
    expect(region.max.y).toBe(69);
  });
});

describe("buildWall 門", () => {
  it("gate 位置に air 開口が空く", () => {
    const { commands } = buildWall(wall({ gate: { position: "center", width: 2, height: 3 } }), ORIGIN);
    // center → pos=floor(9/2)=4, width2 → left=4, right=5。ly=1..3 → y=65..67 が air
    expect(covered(commands, 4, 65, 0, "minecraft:air")).toBe(true);
    expect(covered(commands, 5, 67, 0, "minecraft:air")).toBe(true);
  });
});

describe("parseWallIR クランプ", () => {
  it("極端寸法を範囲にクランプする", () => {
    const r = parseIR({ type: "wall", length: 999, height: 0, thickness: 99 });
    expect(r.ok).toBe(true);
    if (!r.ok || r.ir.type !== "wall") return;
    expect(r.ir.length).toBe(64);
    expect(r.ir.height).toBe(3);
    expect(r.ir.thickness).toBe(4);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
