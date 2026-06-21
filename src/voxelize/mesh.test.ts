import { describe, it, expect } from "vitest";
import { trisToGridIR } from "./mesh.js";

type RGB = [number, number, number];
interface T { a: { x: number; y: number; z: number }; b: { x: number; y: number; z: number }; c: { x: number; y: number; z: number }; color: RGB }

/** [0,size]^3 の立方体（12 三角形）に色を付ける。 */
function cube(size: number, color: RGB): T[] {
  const v = [
    { x: 0, y: 0, z: 0 }, { x: size, y: 0, z: 0 }, { x: size, y: size, z: 0 }, { x: 0, y: size, z: 0 },
    { x: 0, y: 0, z: size }, { x: size, y: 0, z: size }, { x: size, y: size, z: size }, { x: 0, y: size, z: size },
  ];
  const q = (a: number, b: number, c: number, d: number): T[] => [
    { a: v[a]!, b: v[b]!, c: v[c]!, color }, { a: v[a]!, b: v[c]!, c: v[d]!, color },
  ];
  return [
    ...q(0, 1, 2, 3), ...q(4, 5, 6, 7), ...q(0, 1, 5, 4),
    ...q(3, 2, 6, 7), ...q(0, 3, 7, 4), ...q(1, 2, 6, 5),
  ];
}

describe("trisToGridIR (FR-51/52/56)", () => {
  it("solid 立方体は密に埋まり、size が GridIR になる", () => {
    const ir = trisToGridIR(cube(8, [200, 40, 40]), { targetHeight: 8, fill: "solid" });
    expect(ir.type).toBe("grid");
    expect(ir.size.h).toBeGreaterThanOrEqual(7);
    // 占有セル数（非0 voxel）が立方体総量に近い
    let nonAir = 0;
    for (const layer of ir.voxels) for (const row of layer) for (const c of row) if (c !== 0) nonAir++;
    const vol = ir.size.w * ir.size.h * ir.size.d;
    expect(nonAir).toBeGreaterThan(vol * 0.8);
  });

  it("色が量子化され realized palette ができる", () => {
    const ir = trisToGridIR(cube(8, [40, 50, 190]), { targetHeight: 8, fill: "solid" });
    const ids = Object.values(ir.palette);
    expect(ids.length).toBeGreaterThan(0);
    // 青系の立方体は青っぽいブロックを含む
    expect(ids.some((id) => /blue|cyan|purple/.test(id))).toBe(true);
  });

  it("shell は solid より非0 voxel が少ない（中空）", () => {
    const solid = trisToGridIR(cube(10, [120, 120, 120]), { targetHeight: 10, fill: "solid" });
    const shell = trisToGridIR(cube(10, [120, 120, 120]), { targetHeight: 10, fill: "shell" });
    const count = (ir: typeof solid): number => {
      let n = 0;
      for (const layer of ir.voxels) for (const row of layer) for (const c of row) if (c !== 0) n++;
      return n;
    };
    expect(count(shell)).toBeLessThan(count(solid));
  });
});
