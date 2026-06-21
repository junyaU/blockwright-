import { describe, it, expect } from "vitest";
import { pixelsToGridIR, type SourceImage } from "./image.js";
import { quantizeLab } from "./quantize.js";

/** RGBA 配列から SourceImage を作る。pixels は [r,g,b,a] の配列（row-major）。 */
function img(w: number, h: number, pixels: number[][]): SourceImage {
  const rgba: number[] = [];
  for (const p of pixels) rgba.push(p[0]!, p[1]!, p[2]!, p[3]!);
  return { w, h, rgba };
}

// 量子化が異なる 3 色（色名に依存せず quantizeLab と突き合わせて軸を検証する）。
const A = [200, 40, 40, 255];
const B = [40, 50, 190, 255];
const C = [60, 190, 70, 255];
const CLEAR = [0, 0, 0, 0];
const blockOf = (c: number[]) => quantizeLab(c[0]!, c[1]!, c[2]!);
const BLUE = B;

describe("pixelsToGridIR 軸マッピング (R2/AC-33)", () => {
  it("画像の上が world の上になる（上下反転）", () => {
    // w=1,h=2：上=A、下=B。world では上(y=1)=A、下(y=0)=B になるべき。
    const ir = pixelsToGridIR(img(1, 2, [A, B]), { target: 2, thickness: 1 });
    expect(ir.size).toEqual({ w: 1, h: 2, d: 1 });
    expect(ir.palette[ir.voxels[1]![0]![0]!]).toBe(blockOf(A)); // world 上 = 画像上の A
    expect(ir.palette[ir.voxels[0]![0]![0]!]).toBe(blockOf(B)); // world 下 = 画像下の B
    expect(blockOf(A)).not.toBe(blockOf(B));
  });

  it("左右が鏡像化しない", () => {
    // w=2,h=1：左=A、右=C。x=0 が A、x=1 が C のまま。
    const ir = pixelsToGridIR(img(2, 1, [A, C]), { target: 2, thickness: 1 });
    expect(ir.palette[ir.voxels[0]![0]![0]!]).toBe(blockOf(A)); // x=0 左
    expect(ir.palette[ir.voxels[0]![0]![1]!]).toBe(blockOf(C)); // x=1 右
    expect(blockOf(A)).not.toBe(blockOf(C));
  });
});

describe("pixelsToGridIR alpha→air (FR-48)", () => {
  it("透過画素は air(0) になる", () => {
    // w=2,h=1：左=透過、右=青。
    const ir = pixelsToGridIR(img(2, 1, [CLEAR, BLUE]), { target: 2, thickness: 1 });
    expect(ir.voxels[0]![0]![0]).toBe(0); // 透過 → air
    expect(ir.voxels[0]![0]![1]).not.toBe(0); // 青 → ブロック
  });
});

describe("pixelsToGridIR thickness (FR-49)", () => {
  it("厚み分だけ z 方向に複製される", () => {
    const ir = pixelsToGridIR(img(1, 1, [A]), { target: 1, thickness: 3 });
    expect(ir.size).toEqual({ w: 1, h: 1, d: 3 });
    const v = ir.voxels[0]![0]![0]!;
    expect(ir.voxels[0]![1]![0]).toBe(v);
    expect(ir.voxels[0]![2]![0]).toBe(v);
  });
});

describe("pixelsToGridIR realized palette (FR-55)", () => {
  it("使った色数だけ palette ができ 0 は含まない", () => {
    const ir = pixelsToGridIR(img(2, 1, [A, BLUE]), { target: 2, thickness: 1 });
    expect(ir.palette[0]).toBeUndefined();
    expect(Object.keys(ir.palette).length).toBe(2);
  });
});
