/**
 * §4 ボクセル化エンジンのディスパッチャ。
 * リファレンス（画像 / 3Dモデル）→ GridIR を拡張子で振り分ける。
 * 出口は GridIR に揃うので build()（=buildGrid）以降は不変。
 */
import type { GridIR } from "../ir.js";
import { imageToGridIR } from "./image.js";
import { meshToGridIR, type MeshFill } from "./mesh.js";

export interface VoxelizeOptions {
  /** 目標サイズ（画像=最長辺ブロック数 / メッシュ=高さブロック数）。 */
  size?: number;
  /** 画像の厚み（v3.0）。 */
  thickness?: number;
  /** メッシュの占有方式（v3.1）。 */
  fill?: MeshFill;
}

const IMAGE_EXT = /\.(png|jpg|jpeg)$/i;
const MESH_EXT = /\.(obj|glb|gltf)$/i;

/** リファレンスファイル → GridIR。拡張子で image / mesh を選ぶ。 */
export async function voxelizeFile(file: string, opts: VoxelizeOptions = {}): Promise<GridIR> {
  if (IMAGE_EXT.test(file)) {
    return imageToGridIR(file, { target: opts.size, thickness: opts.thickness });
  }
  if (MESH_EXT.test(file)) {
    return meshToGridIR(file, { targetHeight: opts.size, fill: opts.fill });
  }
  throw new Error(`未対応の拡張子です（png/jpg/obj/glb/gltf）: ${file}`);
}
