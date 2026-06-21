/**
 * §6.4 色ユーティリティ。sRGB → CIE Lab 変換と知覚的色差（CIE76）。
 *
 * 量子化（色→ブロック）の最近傍判定は RGB 距離より Lab 距離の方が知覚に近い（R6）。
 * 純粋関数のみ。依存なし。
 */

export type Lab = [L: number, a: number, b: number];

/** sRGB 成分（0..255）を線形値（0..1）へ。 */
function linearize(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Lab の f(t)。 */
function pivot(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

// D65 参照白色点。
const Xn = 0.95047;
const Yn = 1.0;
const Zn = 1.08883;

/** sRGB(0..255) → CIE Lab。 */
export function srgbToLab(r: number, g: number, b: number): Lab {
  const rl = linearize(r);
  const gl = linearize(g);
  const bl = linearize(b);

  const x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / Xn;
  const y = (rl * 0.2126 + gl * 0.7152 + bl * 0.0722) / Yn;
  const z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / Zn;

  const fx = pivot(x);
  const fy = pivot(y);
  const fz = pivot(z);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 色差（Lab 空間のユークリッド距離）。 */
export function deltaE(a: Lab, b: Lab): number {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}
