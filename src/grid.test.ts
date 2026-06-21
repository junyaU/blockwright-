import { describe, it, expect } from "vitest";
import { buildGrid } from "./grid.js";
import { parseIR } from "./ir.js";
import { config } from "./config.js";
import type { GridIR, Vec3 } from "./ir.js";

const ORIGIN: Vec3 = { x: 0, y: 64, z: 0 };
// facing "north" + ORIGIN で、local (lx,ly,lz) → world (lx, 64+ly, lz)。

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

describe("buildGrid 次元順序 voxels[y][z][x] (AC-28/R2)", () => {
  it("付録B の最小例が転置/鏡像せず展開される", () => {
    // size{w:3,h:2,d:1}、底に幅3＋左端に1ブロック積んだL字。
    const ir: GridIR = {
      type: "grid",
      size: { w: 3, h: 2, d: 1 },
      voxels: [[[1, 1, 1]], [[1, 0, 0]]],
      palette: { 1: "minecraft:stone" },
      facing: "north",
    };
    const { commands } = buildGrid(ir, ORIGIN);
    // y=0（下層・world y=64）：x=0..2 すべて stone
    expect(covered(commands, 0, 64, 0, "minecraft:stone")).toBe(true);
    expect(covered(commands, 2, 64, 0, "minecraft:stone")).toBe(true);
    // y=1（上層・world y=65）：x=0 のみ stone、x=1,2 は air
    expect(covered(commands, 0, 65, 0, "minecraft:stone")).toBe(true);
    expect(covered(commands, 1, 65, 0)).toBe(false);
    expect(covered(commands, 2, 65, 0)).toBe(false);
  });
});

describe("buildGrid X-run merge (AC-23/FR-41)", () => {
  it("同一 index の連続を fill に畳み、air で分断される", () => {
    const ir: GridIR = {
      type: "grid",
      size: { w: 5, h: 1, d: 1 },
      voxels: [[[1, 1, 1, 0, 1]]],
      palette: { 1: "minecraft:stone" },
      facing: "north",
    };
    const { commands } = buildGrid(ir, ORIGIN);
    // 非 0 voxel 4 個 → fill 2 本（x0-2, x4-4）。per-voxel より少ない。
    expect(commands.length).toBe(2);
    expect(covered(commands, 0, 64, 0, "minecraft:stone")).toBe(true);
    expect(covered(commands, 2, 64, 0, "minecraft:stone")).toBe(true);
    // 中央 x=3 は air
    expect(covered(commands, 3, 64, 0)).toBe(false);
    expect(covered(commands, 4, 64, 0, "minecraft:stone")).toBe(true);
  });
});

describe("buildGrid 素材フォールバック (FR-43)", () => {
  it("不正形式の palette 値はフォールバックで埋まり穴にならない", () => {
    const ir: GridIR = {
      type: "grid",
      size: { w: 1, h: 1, d: 1 },
      voxels: [[[1]]],
      palette: { 1: "not valid!!" },
      facing: "north",
    };
    const { commands } = buildGrid(ir, ORIGIN);
    expect(covered(commands, 0, 64, 0, config.fallbackMaterial)).toBe(true);
  });
});

describe("buildGrid 全体 AABB (AC-26/FR-44)", () => {
  it("中心 1 セルのみでも region が grid 全体を覆う", () => {
    const voxels: number[][][] = Array.from({ length: 3 }, () =>
      Array.from({ length: 3 }, () => [0, 0, 0]),
    );
    voxels[1]![1]![1] = 1; // 中心のみ
    const ir: GridIR = {
      type: "grid",
      size: { w: 3, h: 3, d: 3 },
      voxels,
      palette: { 1: "minecraft:stone" },
      facing: "north",
    };
    const { region } = buildGrid(ir, ORIGIN);
    expect(region.min).toEqual({ x: 0, y: 64, z: 0 });
    expect(region.max).toEqual({ x: 2, y: 66, z: 2 });
  });
});

describe("buildGrid facing 回転", () => {
  it("facing を変えても既知セルが proper rotation で写る", () => {
    const ir: GridIR = {
      type: "grid",
      size: { w: 3, h: 1, d: 1 },
      voxels: [[[1, 0, 0]]],
      palette: { 1: "minecraft:stone" },
      facing: "east",
    };
    const { commands } = buildGrid(ir, ORIGIN);
    // east: local(0,0,0) → rotateXZ {x:d-1-lz=0, z:lx=0} → world (0,64,0)
    expect(covered(commands, 0, 64, 0, "minecraft:stone")).toBe(true);
    expect(commands.length).toBe(1);
  });
});

describe("parseGridIR 検証 (FR-42/46)", () => {
  it("voxels 次元が size と不一致なら拒否する", () => {
    const r = parseIR({
      type: "grid",
      size: { w: 2, h: 1, d: 1 },
      voxels: [[[1]]], // x 次元 1 ≠ w 2
      palette: { 1: "minecraft:stone" },
    });
    expect(r.ok).toBe(false);
  });

  it("voxels が使う index が palette に無ければ拒否する", () => {
    const r = parseIR({
      type: "grid",
      size: { w: 2, h: 1, d: 1 },
      voxels: [[[1, 2]]],
      palette: { 1: "minecraft:stone" }, // 2 が無い
    });
    expect(r.ok).toBe(false);
  });

  it("総量が上限を超えたら拒否する", () => {
    const r = parseIR({ type: "grid", size: { w: 64, h: 64, d: 64 }, voxels: [], palette: {} });
    expect(r.ok).toBe(false);
  });

  it("正しい grid は ok で、key 0 は警告して無視される", () => {
    const r = parseIR({
      type: "grid",
      size: { w: 1, h: 1, d: 1 },
      voxels: [[[1]]],
      palette: { 0: "minecraft:air", 1: "minecraft:stone" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok || r.ir.type !== "grid") return;
    expect(r.ir.palette[0]).toBeUndefined();
    expect(r.ir.palette[1]).toBe("minecraft:stone");
    expect(r.warnings.some((w) => w.includes("0"))).toBe(true);
  });
});
