import { describe, it, expect } from "vitest";
import { buildBridge } from "./bridge.js";
import { parseIR, BRIDGE_PIER_DEPTH } from "./ir.js";
import type { BridgeIR, Vec3 } from "./ir.js";

const ORIGIN: Vec3 = { x: 0, y: 64, z: 0 };
// facing "north" + ORIGIN で、local (lx,ly,lz) → world (lx, 64+ly, lz)。
// stone style: floor=stone, wall=stone_bricks, trim=chiseled_stone_bricks。

function bridge(overrides: Partial<BridgeIR>): BridgeIR {
  return {
    type: "bridge",
    span: 12,
    width: 4,
    railing: true,
    piers: true,
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

describe("buildBridge 桁・欄干", () => {
  it("deck が ly=0 に span×width で敷かれる", () => {
    const { commands } = buildBridge(bridge({}), ORIGIN);
    expect(covered(commands, 0, 64, 0, "minecraft:stone")).toBe(true);
    expect(covered(commands, 11, 64, 3, "minecraft:stone")).toBe(true);
  });

  it("両側の縁に欄干が ly=1 で立つ", () => {
    const { commands } = buildBridge(bridge({ railing: true }), ORIGIN);
    // 縁 lz=0 と lz=width-1=3 → world z=0,3、ly=1 → y=65
    expect(covered(commands, 5, 65, 0, "minecraft:stone_bricks")).toBe(true);
    expect(covered(commands, 5, 65, 3, "minecraft:stone_bricks")).toBe(true);
  });

  it("railing:false なら欄干が無い", () => {
    const { commands } = buildBridge(bridge({ railing: false, piers: false }), ORIGIN);
    expect(covered(commands, 5, 65, 0)).toBe(false);
  });
});

describe("buildBridge 橋脚", () => {
  it("piers が deck の下（ly<0）に降りる", () => {
    const { commands, region } = buildBridge(bridge({ piers: true }), ORIGIN);
    // 端 x=0 の橋脚は ly=-1..-depth → world y=63..(64-depth)
    expect(covered(commands, 0, 63, 0, "minecraft:chiseled_stone_bricks")).toBe(true);
    expect(region.min.y).toBe(64 - BRIDGE_PIER_DEPTH);
  });

  it("piers:false なら deck 面が最下層", () => {
    const { region } = buildBridge(bridge({ piers: false }), ORIGIN);
    expect(region.min.y).toBe(64);
  });
});

describe("parseBridgeIR クランプ", () => {
  it("極端寸法を範囲にクランプする", () => {
    const r = parseIR({ type: "bridge", span: 999, width: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok || r.ir.type !== "bridge") return;
    expect(r.ir.span).toBe(64);
    expect(r.ir.width).toBe(2);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
