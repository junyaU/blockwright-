import { describe, it, expect } from "vitest";
import { cleanupMesh, largestComponent, recenter } from "./cleanup.js";
import type { ColoredTri } from "../voxelize/mesh.js";

const GRAY: [number, number, number] = [150, 150, 150];

/** [o,o+size]^3 の立方体（12 三角形）。o でオフセット可能。 */
function cube(size: number, o = 0): ColoredTri[] {
  const v = [
    { x: o, y: o, z: o }, { x: o + size, y: o, z: o }, { x: o + size, y: o + size, z: o }, { x: o, y: o + size, z: o },
    { x: o, y: o, z: o + size }, { x: o + size, y: o, z: o + size }, { x: o + size, y: o + size, z: o + size }, { x: o, y: o + size, z: o + size },
  ];
  const q = (a: number, b: number, c: number, d: number): ColoredTri[] => [
    { a: v[a]!, b: v[b]!, c: v[c]!, color: GRAY }, { a: v[a]!, b: v[c]!, c: v[d]!, color: GRAY },
  ];
  return [
    ...q(0, 1, 2, 3), ...q(4, 5, 6, 7), ...q(0, 1, 5, 4),
    ...q(3, 2, 6, 7), ...q(0, 3, 7, 4), ...q(1, 2, 6, 5),
  ];
}

describe("largestComponent / cleanupMesh (AC-41)", () => {
  it("浮遊した小片を捨て、主要部（立方体）だけ残す", () => {
    const main = cube(10);
    const floater: ColoredTri = {
      a: { x: 100, y: 100, z: 100 }, b: { x: 101, y: 100, z: 100 }, c: { x: 100, y: 101, z: 100 }, color: GRAY,
    };
    const keep = largestComponent([...main, floater]);
    expect(keep.size).toBe(12); // 立方体の 12 三角形のみ
    expect(keep.has(12)).toBe(false); // 浮遊片(index 12)は捨てる

    const cleaned = cleanupMesh([...main, floater]);
    expect(cleaned.length).toBe(12);
  });

  it("連結した立方体は全三角形を残す", () => {
    expect(largestComponent(cube(4)).size).toBe(12);
  });
});

describe("recenter", () => {
  it("AABB 中心が原点へ移動する", () => {
    const cleaned = recenter(cube(10, 50)); // 50..60 → 中心 55
    let minX = Infinity, maxX = -Infinity;
    for (const t of cleaned) for (const p of [t.a, t.b, t.c]) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); }
    expect((minX + maxX) / 2).toBeCloseTo(0, 6);
  });
});
