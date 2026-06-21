import { describe, it, expect } from "vitest";
import { rasterizeShell, fillSolid, cellIndex, decodeCell, type Tri, type GridSpace } from "./occupancy.js";

/** 単位立方体 [0,size]^3 を 12 三角形で。 */
function cubeTris(size: number): Tri[] {
  const v = [
    { x: 0, y: 0, z: 0 }, { x: size, y: 0, z: 0 }, { x: size, y: size, z: 0 }, { x: 0, y: size, z: 0 },
    { x: 0, y: 0, z: size }, { x: size, y: 0, z: size }, { x: size, y: size, z: size }, { x: 0, y: size, z: size },
  ];
  const q = (a: number, b: number, c: number, d: number): Tri[] => [
    { a: v[a]!, b: v[b]!, c: v[c]! }, { a: v[a]!, b: v[c]!, c: v[d]! },
  ];
  return [
    ...q(0, 1, 2, 3), ...q(4, 5, 6, 7), ...q(0, 1, 5, 4),
    ...q(3, 2, 6, 7), ...q(0, 3, 7, 4), ...q(1, 2, 6, 5),
  ];
}

describe("cellIndex / decodeCell 往復", () => {
  it("エンコード→デコードで戻る", () => {
    const dims = { w: 5, h: 3, d: 4 };
    for (const [x, y, z] of [[0, 0, 0], [4, 2, 3], [2, 1, 2]] as const) {
      expect(decodeCell(cellIndex(x, y, z, dims), dims)).toEqual([x, y, z]);
    }
  });
});

describe("rasterizeShell / fillSolid (FR-51)", () => {
  const dims = { w: 4, h: 4, d: 4 };
  const gs: GridSpace = { min: { x: 0, y: 0, z: 0 }, voxelSize: 1, dims };
  const shell = rasterizeShell(cubeTris(4), gs);

  it("shell は外殻セルのみ（内部 2x2x2 は空く）", () => {
    const cells = new Set(shell.keys());
    // 角は占有
    expect(cells.has(cellIndex(0, 0, 0, dims))).toBe(true);
    // 内部 (1,1,1) は shell に含まれない
    expect(cells.has(cellIndex(1, 1, 1, dims))).toBe(false);
  });

  it("solid は内部を埋め、全 64 セル占有", () => {
    const occ = fillSolid(shell.keys(), dims);
    expect(occ.size).toBe(64);
    expect(occ.has(cellIndex(1, 1, 1, dims))).toBe(true);
  });
});

describe("軸の非対称性 (R2)", () => {
  it("片隅だけの三角形は対角の隅を占有しない", () => {
    const dims = { w: 4, h: 4, d: 4 };
    const gs: GridSpace = { min: { x: 0, y: 0, z: 0 }, voxelSize: 1, dims };
    // 原点側の小三角形（x,y,z すべて小）。
    const tri: Tri = { a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 }, c: { x: 0, y: 1, z: 0 } };
    const cells = new Set(rasterizeShell([tri], gs).keys());
    expect(cells.has(cellIndex(0, 0, 0, dims))).toBe(true);
    expect(cells.has(cellIndex(3, 3, 3, dims))).toBe(false);
  });
});
