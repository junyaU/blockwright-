/**
 * §6.4 v5 決定論変形エンジン（安い修正）。
 *
 * すべて純粋関数 GridIR → GridIR。生成器（v4）を呼ばない・外部 I/O なし（FR-74/75/76）。
 * - recolor : palette 再マッピング（voxel index 構造は不変）。
 * - rescale : voxel グリッド再サンプリング（最近傍）。GRID_SIZE_MAX へクランプ。
 * - mirror  : 指定軸で voxels[y][z][x] を反転。
 * - rotate  : Y 軸まわり 90°回転（次元入れ替え＋反転）。size.w/d も入れ替わる。
 *
 * ★単体テスト必須（§8）。特に rescale の再量子化、rotate の軸入れ替えはバグりやすい。
 */
import { type GridIR, GRID_SIZE_MAX } from "../ir.js";
import { resolveMaterial } from "../materials.js";
import type { RecolorMap } from "./interpret.js";

/** h×d×w の 0 埋め 3 次元配列を作る（voxels[y][z][x]）。 */
function make3d(h: number, d: number, w: number): number[][][] {
  const out: number[][][] = [];
  for (let y = 0; y < h; y++) {
    const layer: number[][] = [];
    for (let z = 0; z < d; z++) layer.push(new Array<number>(w).fill(0));
    out.push(layer);
  }
  return out;
}

/** voxels を深いコピー（変形は新インスタンスを返す＝入力を破壊しない）。 */
function cloneVoxels(voxels: number[][][]): number[][][] {
  return voxels.map((layer) => layer.map((row) => row.slice()));
}

/**
 * recolor：mapping に従い palette を差し替える。voxel の index 構造はそのまま。
 * - from が整数：その index の素材を to に差し替え。
 * - from が文字列："all"/"*"/空 は全 index、それ以外は現素材名に部分一致する index を対象。
 * to は resolveMaterial で検証（JE→BE 補正・不正形式はフォールバック）。
 */
export function recolor(ir: GridIR, mapping: RecolorMap[]): GridIR {
  const palette: Record<number, string> = { ...ir.palette };
  const indices = Object.keys(palette).map(Number);

  for (const m of mapping) {
    const to = resolveMaterial(m.to).material;
    if (typeof m.from === "number") {
      if (palette[m.from] !== undefined) palette[m.from] = to;
      continue;
    }
    const hint = m.from.trim().toLowerCase();
    const all = hint === "" || hint === "all" || hint === "*";
    for (const idx of indices) {
      if (all || palette[idx]!.toLowerCase().includes(hint)) palette[idx] = to;
    }
  }

  return { ...ir, palette, voxels: cloneVoxels(ir.voxels) };
}

/**
 * rescale：最長辺が targetSize になるよう等比でリサイズし、最近傍で再サンプリングする。
 * 各次元は 1..GRID_SIZE_MAX にクランプ。小特徴の消失は許容（R3）。palette は不変。
 */
export function rescale(ir: GridIR, targetSize: number): GridIR {
  const { w, h, d } = ir.size;
  const longest = Math.max(w, h, d);
  const scale = targetSize / longest;
  const clampDim = (n: number) => Math.min(GRID_SIZE_MAX, Math.max(1, Math.round(n * scale)));
  const w2 = clampDim(w);
  const h2 = clampDim(h);
  const d2 = clampDim(d);

  const out = make3d(h2, d2, w2);
  for (let y = 0; y < h2; y++) {
    // 最近傍：出力座標 → 入力座標（floor でソースセルを選ぶ）。
    const sy = Math.min(h - 1, Math.floor((y * h) / h2));
    for (let z = 0; z < d2; z++) {
      const sz = Math.min(d - 1, Math.floor((z * d) / d2));
      for (let x = 0; x < w2; x++) {
        const sx = Math.min(w - 1, Math.floor((x * w) / w2));
        out[y]![z]![x] = ir.voxels[sy]![sz]![sx]!;
      }
    }
  }

  return { ...ir, size: { w: w2, h: h2, d: d2 }, voxels: out };
}

/**
 * mirror：指定軸で反転。x=各行を逆順（左右反転）、z=行順を逆（前後反転）。
 * size・palette は不変。
 */
export function mirror(ir: GridIR, axis: "x" | "z"): GridIR {
  const { w, h, d } = ir.size;
  const out = make3d(h, d, w);
  for (let y = 0; y < h; y++) {
    for (let z = 0; z < d; z++) {
      const sz = axis === "z" ? d - 1 - z : z;
      for (let x = 0; x < w; x++) {
        const sx = axis === "x" ? w - 1 - x : x;
        out[y]![z]![x] = ir.voxels[y]![sz]![sx]!;
      }
    }
  }
  return { ...ir, voxels: out };
}

/** Y 軸まわり 90°反時計回り 1 回転。w/d が入れ替わる。 */
function rotate90(ir: GridIR): GridIR {
  const { w, h, d } = ir.size;
  // 反時計回り(CCW)：(x,z) → (x',z') with x'=z, z'=w-1-x。新 w'=d, d'=w。
  const w2 = d;
  const d2 = w;
  const out = make3d(h, d2, w2);
  for (let y = 0; y < h; y++) {
    for (let z = 0; z < d; z++) {
      for (let x = 0; x < w; x++) {
        const x2 = z;
        const z2 = w - 1 - x;
        out[y]![z2]![x2] = ir.voxels[y]![z]![x]!;
      }
    }
  }
  return { ...ir, size: { w: w2, h, d: d2 }, voxels: out };
}

/**
 * rotate：Y 軸まわり 90°単位の回転（quarterTurns 回）。
 * アセットに焼き込む方式（facing でなく voxel を回す）＝一貫性が高い（§6.4）。
 * palette は不変。size.w/d は奇数回で入れ替わる。
 */
export function rotate(ir: GridIR, quarterTurns: 1 | 2 | 3): GridIR {
  let cur = ir;
  for (let i = 0; i < quarterTurns; i++) cur = rotate90(cur);
  return cur;
}
