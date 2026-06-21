import { describe, it, expect } from "vitest";
import { buildTower } from "./tower.js";
import { parseIR } from "./ir.js";
import type { TowerIR, Vec3 } from "./ir.js";

const ORIGIN: Vec3 = { x: 0, y: 64, z: 0 };
// facing "north" + ORIGIN で、local (lx,ly,lz) → world (lx, 64+ly, lz)（オフセット無し）。
// stone style: wall=stone_bricks, floor=stone, roof=cobblestone, trim=chiseled_stone_bricks, window=glass。

function tower(overrides: Partial<TowerIR>): TowerIR {
  return {
    type: "tower",
    footprint: { w: 5, d: 5 },
    height: 8,
    cap: "battlement",
    shape: "square",
    facing: "north",
    style: "stone",
    windows: { pattern: "none" },
    ...overrides,
  };
}

function parseFill(cmd: string): { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; mat: string } | null {
  const m = cmd.match(/^fill (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (\S+)/);
  if (!m) return null;
  const n = m.slice(1, 7).map(Number) as number[];
  return { x0: n[0]!, y0: n[1]!, z0: n[2]!, x1: n[3]!, y1: n[4]!, z1: n[5]!, mat: m[7]! };
}

/** ワールド点 (x,y,z) を覆う fill / setblock が commands にあるか。 */
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

describe("buildTower 躯体 (FR-29/30)", () => {
  it("床・四方の壁・正面ドア開口がある", () => {
    const { commands } = buildTower(tower({}), ORIGIN);
    // 床 ly=0 → world y=64
    expect(covered(commands, 2, 64, 2, "minecraft:stone")).toBe(true);
    // 背面壁 lz=d-1=4 → world z=4、ly=4 → y=68（ドア・スリットと無関係なセル）
    expect(covered(commands, 2, 68, 4, "minecraft:stone_bricks")).toBe(true);
    // ドア開口：w=5 → doorX=2 → world x=2、正面 z=0、ly=1,2 → y=65,66 が air
    expect(covered(commands, 2, 65, 0, "minecraft:air")).toBe(true);
    expect(covered(commands, 2, 66, 0, "minecraft:air")).toBe(true);
  });
});

describe("buildTower flat cap (FR-31)", () => {
  it("ly=h+1（world y=73）に平天井があり、region 頂が 73", () => {
    const { commands, region } = buildTower(tower({ cap: "flat" }), ORIGIN);
    expect(covered(commands, 2, 73, 2, "minecraft:cobblestone")).toBe(true);
    expect(region.max.y).toBe(73);
  });
});

describe("buildTower battlement cap (FR-32)", () => {
  it("胸壁が交互に並び、四隅は必ず立ち、region 頂が merlon を含む", () => {
    const { commands, region } = buildTower(tower({ cap: "battlement" }), ORIGIN);
    // ly=h+1=9 → world y=73 に外周リング（cobblestone）
    expect(covered(commands, 1, 73, 0, "minecraft:cobblestone")).toBe(true);
    // 四隅 (0,0) → merlon（trim=chiseled_stone_bricks）が ly=h+2=10 → world y=74
    expect(covered(commands, 0, 74, 0, "minecraft:chiseled_stone_bricks")).toBe(true);
    // 1つおき：(1,0) は (x+z) 奇数かつ非隅 → merlon 無し
    expect(covered(commands, 1, 74, 0)).toBe(false);
    // region 頂が merlon（74）を含む（Undo 完全性 FR-36）
    expect(region.max.y).toBe(74);
  });
});

describe("buildTower 縦スリット (FR-33)", () => {
  it("glass スリットが配置され、正面ドア列には glass が無い", () => {
    const { commands } = buildTower(tower({ windows: { pattern: "slit", sill: 2, span: 3 } }), ORIGIN);
    const slits = commands.filter((c) => c.includes("minecraft:glass"));
    expect(slits.length).toBeGreaterThan(0);
    // 正面スリットは x=1,3（doorX=2 を除外）。x=1 の縦スリットが y=67..69 にある
    expect(covered(commands, 1, 67, 0, "minecraft:glass")).toBe(true);
    // ドア列 world x=2, 正面 z=0 には glass が無い
    expect(covered(commands, 2, 67, 0, "minecraft:glass")).toBe(false);
  });
});

describe("buildTower facing 回転 (FR-37/R2)", () => {
  it("facing を変えても躯体が閉じ、merlon が proper rotation で外周に来る", () => {
    const { commands, region } = buildTower(tower({ facing: "east" }), ORIGIN);
    // 床は回転しても存在する：local 中央 (2,0,2) → east 回転 world (2,64,2)
    expect(covered(commands, 2, 64, 2, "minecraft:stone")).toBe(true);
    // east 回転で local 隅 (0,0) → world (d-1, 0)=(4,0) の merlon
    expect(covered(commands, 4, 74, 0, "minecraft:chiseled_stone_bricks")).toBe(true);
    expect(region.max.y).toBe(74);
  });
});

describe("parseTowerIR クランプ・縮退 (FR-34/35)", () => {
  it("極端寸法を範囲にクランプする", () => {
    const r = parseIR({ type: "tower", footprint: { w: 100, d: 1 }, height: 999 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ir.type).toBe("tower");
    if (r.ir.type !== "tower") return;
    expect(r.ir.footprint.w).toBe(16);
    expect(r.ir.footprint.d).toBe(3);
    expect(r.ir.height).toBe(48);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('shape:"round" は square に縮退し警告する', () => {
    const r = parseIR({ type: "tower", footprint: { w: 6, d: 6 }, height: 10, shape: "round" });
    expect(r.ok).toBe(true);
    if (!r.ok || r.ir.type !== "tower") return;
    expect(r.ir.shape).toBe("square");
    expect(r.warnings.some((w) => w.includes("round"))).toBe(true);
  });

  it("taper 非 0 は警告して捨てる", () => {
    const r = parseIR({ type: "tower", footprint: { w: 6, d: 6 }, height: 10, taper: 3 });
    expect(r.ok).toBe(true);
    if (!r.ok || r.ir.type !== "tower") return;
    expect(r.ir.taper).toBeUndefined();
    expect(r.warnings.some((w) => w.includes("taper"))).toBe(true);
  });
});
