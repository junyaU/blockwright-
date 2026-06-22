import { describe, it, expect } from "vitest";
import { recolor, rescale, mirror, rotate } from "./transform.js";
import type { GridIR } from "../ir.js";

/** w=2,h=1,d=3。非対称：唯一の非空セルは前面左(x=0,z=0)=1。向きの検証用。 */
function corner(): GridIR {
  return {
    type: "grid",
    size: { w: 2, h: 1, d: 3 },
    voxels: [
      [
        [1, 0], // z=0
        [0, 0], // z=1
        [0, 0], // z=2
      ],
    ],
    palette: { 1: "minecraft:stone" },
    facing: "north",
  };
}

describe("recolor", () => {
  it("数値 from で該当 index の素材だけ差し替える（voxel 不変）", () => {
    const ir: GridIR = {
      type: "grid",
      size: { w: 2, h: 1, d: 1 },
      voxels: [[[1, 2]]],
      palette: { 1: "minecraft:stone", 2: "minecraft:oak_planks" },
      facing: "north",
    };
    const out = recolor(ir, [{ from: 1, to: "minecraft:blue_concrete" }]);
    expect(out.palette).toEqual({ 1: "minecraft:blue_concrete", 2: "minecraft:oak_planks" });
    expect(out.voxels).toEqual(ir.voxels); // 構造不変
    expect(ir.palette[1]).toBe("minecraft:stone"); // 入力非破壊
  });

  it('"all" で全 index を差し替える', () => {
    const ir = corner();
    const out = recolor(ir, [{ from: "all", to: "minecraft:gold_block" }]);
    expect(out.palette).toEqual({ 1: "minecraft:gold_block" });
  });

  it("色ヒント（素材名の部分一致）で対象 index を選ぶ", () => {
    const ir: GridIR = {
      type: "grid",
      size: { w: 2, h: 1, d: 1 },
      voxels: [[[1, 2]]],
      palette: { 1: "minecraft:oak_planks", 2: "minecraft:stone" },
      facing: "north",
    };
    const out = recolor(ir, [{ from: "oak", to: "minecraft:birch_planks" }]);
    expect(out.palette[1]).toBe("minecraft:birch_planks");
    expect(out.palette[2]).toBe("minecraft:stone");
  });

  it("to を resolveMaterial で検証する（JE→BE 補正）", () => {
    const ir = corner();
    const out = recolor(ir, [{ from: 1, to: "grass" }]);
    expect(out.palette[1]).toBe("minecraft:grass_block");
  });
});

describe("rescale", () => {
  it("最長辺を targetSize にし等比リサイズ（最近傍）", () => {
    const ir: GridIR = {
      type: "grid",
      size: { w: 2, h: 2, d: 2 },
      voxels: [
        [[1, 1], [1, 1]],
        [[1, 1], [1, 1]],
      ],
      palette: { 1: "minecraft:stone" },
      facing: "north",
    };
    const out = rescale(ir, 4);
    expect(out.size).toEqual({ w: 4, h: 4, d: 4 });
    // 全セルが 1（充填の拡大）。
    expect(out.voxels.flat(2).every((v) => v === 1)).toBe(true);
  });

  it("GRID_SIZE_MAX(64) を超えない", () => {
    const ir: GridIR = {
      type: "grid",
      size: { w: 10, h: 10, d: 10 },
      voxels: Array.from({ length: 10 }, () =>
        Array.from({ length: 10 }, () => new Array<number>(10).fill(1)),
      ),
      palette: { 1: "minecraft:stone" },
      facing: "north",
    };
    const out = rescale(ir, 200);
    expect(out.size.w).toBeLessThanOrEqual(64);
    expect(out.size.h).toBeLessThanOrEqual(64);
    expect(out.size.d).toBeLessThanOrEqual(64);
  });
});

describe("mirror", () => {
  it("x 反転で前面左→前面右へ移る", () => {
    const out = mirror(corner(), "x");
    expect(out.size).toEqual({ w: 2, h: 1, d: 3 });
    expect(out.voxels[0]![0]).toEqual([0, 1]); // x=1 に移動
  });

  it("z 反転で前面→背面へ移る", () => {
    const out = mirror(corner(), "z");
    expect(out.voxels[0]![0]).toEqual([0, 0]); // z=0 は空
    expect(out.voxels[0]![2]).toEqual([1, 0]); // z=2 に移動
  });
});

describe("rotate", () => {
  it("90°×1 で w/d が入れ替わり、向きが既知の位置へ移る", () => {
    const out = rotate(corner(), 1);
    expect(out.size).toEqual({ w: 3, h: 1, d: 2 }); // w'=d=3, d'=w=2
    // CCW：(x=0,z=0) → x'=z=0, z'=w-1-x=1 ⇒ out[0][1][0]=1
    expect(out.voxels[0]![1]![0]).toBe(1);
    expect(out.voxels.flat(2).filter((v) => v === 1).length).toBe(1);
  });

  it("90°×4 で元に戻る", () => {
    const ir = corner();
    let cur = ir;
    for (let i = 0; i < 4; i++) cur = rotate(cur, 1);
    expect(cur.size).toEqual(ir.size);
    expect(cur.voxels).toEqual(ir.voxels);
  });

  it("180°回転は w/d を保ち対角へ移す", () => {
    const out = rotate(corner(), 2);
    expect(out.size).toEqual({ w: 2, h: 1, d: 3 });
    // (x=0,z=0) → (x=1,z=2)
    expect(out.voxels[0]![2]![1]).toBe(1);
  });
});
