/**
 * §6.2 v3.0：平面画像 → GridIR。
 *
 * 画素を area-average で目標サイズへ縮小し、alpha 透過を air、色を Lab 最近傍でブロック化する。
 * ★軸マッピング（R2）：x=px、y=(H-1)-py（画像は上原点なので上下反転）、z=0..thickness-1（厚み複製）。
 * デコード（jimp）は I/O シェル、変換 pixelsToGridIR は純粋関数（テスト対象）。
 */
import { Jimp } from "jimp";
import type { GridIR } from "../ir.js";
import { GRID_SIZE_MAX, GRID_VOLUME_MAX } from "../ir.js";
import { quantizeLab, PaletteBuilder } from "./quantize.js";

/** 画素データ（RGBA・row-major、index = (y*w+x)*4）。 */
export interface SourceImage {
  w: number;
  h: number;
  rgba: ArrayLike<number>;
}

export interface ImageOptions {
  /** 目標サイズ（最長辺のブロック数）。既定は元画像の最長辺。 */
  target?: number;
  /** 奥行き（厚み）。既定 1。 */
  thickness?: number;
  /** これ未満の平均 alpha は air にする。既定 128。 */
  alphaThreshold?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** アスペクト比保持で目標寸法を決める（各≤GRID_SIZE_MAX、総量≤GRID_VOLUME_MAX）。 */
function fitTarget(w: number, h: number, target: number, thickness: number): { tw: number; th: number } {
  const scale = target / Math.max(w, h);
  let tw = Math.max(1, Math.round(w * scale));
  let th = Math.max(1, Math.round(h * scale));
  if (tw > GRID_SIZE_MAX || th > GRID_SIZE_MAX) {
    const f = GRID_SIZE_MAX / Math.max(tw, th);
    tw = Math.max(1, Math.round(tw * f));
    th = Math.max(1, Math.round(th * f));
  }
  if (tw * th * thickness > GRID_VOLUME_MAX) {
    const f = Math.sqrt(GRID_VOLUME_MAX / (tw * th * thickness));
    tw = Math.max(1, Math.floor(tw * f));
    th = Math.max(1, Math.floor(th * f));
  }
  return { tw, th };
}

/** 目標セル (px,py) が覆うソース領域を alpha 重み付きで平均する（box filter）。 */
function averageRegion(img: SourceImage, px: number, py: number, tw: number, th: number): { r: number; g: number; b: number; a: number } {
  const x0 = Math.floor((px * img.w) / tw);
  const x1 = Math.max(x0 + 1, Math.floor(((px + 1) * img.w) / tw));
  const y0 = Math.floor((py * img.h) / th);
  const y1 = Math.max(y0 + 1, Math.floor(((py + 1) * img.h) / th));
  let rs = 0, gs = 0, bs = 0, aSum = 0, aWeight = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.w + x) * 4;
      const a = img.rgba[i + 3]!;
      rs += img.rgba[i]! * a;
      gs += img.rgba[i + 1]! * a;
      bs += img.rgba[i + 2]! * a;
      aSum += a;
      aWeight += a;
      n += 1;
    }
  }
  const avgA = n > 0 ? aSum / n : 0;
  if (aWeight === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return { r: rs / aWeight, g: gs / aWeight, b: bs / aWeight, a: avgA };
}

/** 画素 → GridIR（純粋）。 */
export function pixelsToGridIR(img: SourceImage, opts: ImageOptions = {}): GridIR {
  const thickness = clamp(Math.round(opts.thickness ?? 1), 1, GRID_SIZE_MAX);
  const alphaThreshold = opts.alphaThreshold ?? 128;
  const target = opts.target ?? Math.max(img.w, img.h);
  const { tw, th } = fitTarget(img.w, img.h, target, thickness);

  const pb = new PaletteBuilder();
  // voxels[y][z][x]
  const voxels: number[][][] = Array.from({ length: th }, () =>
    Array.from({ length: thickness }, () => new Array<number>(tw).fill(0)),
  );

  for (let py = 0; py < th; py++) {
    for (let px = 0; px < tw; px++) {
      const { r, g, b, a } = averageRegion(img, px, py, tw, th);
      if (a < alphaThreshold) continue; // air（skip）
      const idx = pb.intern(quantizeLab(r, g, b));
      const y = th - 1 - py; // 上下反転（画像は上原点 → world は上が大きい y）
      for (let z = 0; z < thickness; z++) voxels[y]![z]![px] = idx;
    }
  }

  return { type: "grid", size: { w: tw, h: th, d: thickness }, voxels, palette: pb.toPalette(), facing: "auto" };
}

/** PNG 等を decode して画素を取り出す（I/O シェル）。 */
export async function loadImagePixels(file: string): Promise<SourceImage> {
  const img = await Jimp.read(file);
  return { w: img.bitmap.width, h: img.bitmap.height, rgba: img.bitmap.data };
}

/** 画像ファイル → GridIR（v3.0 入口）。 */
export async function imageToGridIR(file: string, opts: ImageOptions = {}): Promise<GridIR> {
  const img = await loadImagePixels(file);
  return pixelsToGridIR(img, opts);
}
