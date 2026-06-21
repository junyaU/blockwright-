/**
 * §6.3 v3.1：3Dモデル(.obj/.glb) → GridIR（道A・決定論ボクセル化）。
 *
 * メッシュ読込 → グリッド合わせ → 占有判定(shell/solid) → 表面色サンプリング →
 * 色量子化 → 軸マッピング → GridIR。占有（形）は 100% コード、AI は関与しない。
 * 占有/flood-fill は occupancy.ts（純粋）に委譲。色付けと読込のみ本ファイル。
 */
import { readFileSync } from "node:fs";
import { Jimp } from "jimp";
import { NodeIO } from "@gltf-transform/core";
import type { GridIR } from "../ir.js";
import { GRID_SIZE_MAX, GRID_VOLUME_MAX } from "../ir.js";
import { quantizeLab, PaletteBuilder } from "./quantize.js";
import {
  rasterizeShell, fillSolid, cellIndex, decodeCell,
  type Tri, type Vec3f, type Dims, type GridSpace,
} from "./occupancy.js";

export type MeshFill = "shell" | "solid";
type RGB = [number, number, number];
const DEFAULT_COLOR: RGB = [150, 150, 150];

/** 色を持つ三角形（占有時に最寄り三角形の色を引くため、読込時に代表色を確定する）。 */
interface ColoredTri extends Tri {
  color: RGB;
}

export interface MeshOptions {
  /** 目標の高さ（ブロック数）。既定 24。 */
  targetHeight?: number;
  /** 占有方式。既定 "solid"。 */
  fill?: MeshFill;
}

// ---- .obj パース（自前・テクスチャ無し＝既定グレー） ----

function parseObj(text: string): ColoredTri[] {
  const verts: Vec3f[] = [];
  const tris: ColoredTri[] = [];
  for (const line of text.split(/\r?\n/)) {
    const tok = line.trim().split(/\s+/);
    if (tok[0] === "v") {
      verts.push({ x: Number(tok[1]), y: Number(tok[2]), z: Number(tok[3]) });
    } else if (tok[0] === "f") {
      // 面は多角形ありうる → 三角形ファンに分解。各頂点は "v/vt/vn" の v のみ使う。
      const idx = tok.slice(1).map((t) => {
        const vi = Number(t.split("/")[0]);
        return vi < 0 ? verts.length + vi : vi - 1; // 1-based / 負index
      });
      for (let i = 1; i + 1 < idx.length; i++) {
        const a = verts[idx[0]!], b = verts[idx[i]!], c = verts[idx[i + 1]!];
        if (a && b && c) tris.push({ a, b, c, color: DEFAULT_COLOR });
      }
    }
  }
  return tris;
}

// ---- .glb / .gltf 読込（@gltf-transform）。位置をワールド化し、三角形の代表色を確定 ----

/** 4x4 列優先行列の積。 */
function matMul(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
      out[c * 4 + r] = s;
    }
  }
  return out;
}

/** 列優先行列で点を変換。 */
function transformPoint(m: number[], p: Vec3f): Vec3f {
  return {
    x: m[0]! * p.x + m[4]! * p.y + m[8]! * p.z + m[12]!,
    y: m[1]! * p.x + m[5]! * p.y + m[9]! * p.z + m[13]!,
    z: m[2]! * p.x + m[6]! * p.y + m[10]! * p.z + m[14]!,
  };
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

async function parseGlb(file: string): Promise<ColoredTri[]> {
  const io = new NodeIO();
  const doc = await io.read(file);
  const tris: ColoredTri[] = [];
  const textureCache = new Map<unknown, Awaited<ReturnType<typeof Jimp.read>> | null>();

  async function texColor(mat: ReturnType<ReturnType<typeof doc.getRoot>["listMaterials"]>[number] | null, uv: [number, number] | null): Promise<RGB> {
    if (!mat) return DEFAULT_COLOR;
    const tex = mat.getBaseColorTexture();
    if (tex && uv) {
      let img = textureCache.get(tex) ?? null;
      if (!textureCache.has(tex)) {
        const bytes = tex.getImage();
        img = bytes ? await Jimp.read(Buffer.from(bytes)) : null;
        textureCache.set(tex, img);
      }
      if (img) {
        const tw = img.bitmap.width, th = img.bitmap.height;
        const u = ((uv[0] % 1) + 1) % 1;
        const v = ((uv[1] % 1) + 1) % 1;
        const px = Math.min(tw - 1, Math.floor(u * tw));
        const py = Math.min(th - 1, Math.floor(v * th)); // glTF UV は上原点
        const i = (py * tw + px) * 4;
        return [img.bitmap.data[i]!, img.bitmap.data[i + 1]!, img.bitmap.data[i + 2]!];
      }
    }
    const f = mat.getBaseColorFactor();
    if (f) return [Math.round(f[0]! * 255), Math.round(f[1]! * 255), Math.round(f[2]! * 255)];
    return DEFAULT_COLOR;
  }

  // シーングラフを辿りワールド行列を合成。
  async function walk(node: ReturnType<ReturnType<typeof doc.getRoot>["listNodes"]>[number], parent: number[]): Promise<void> {
    const world = matMul(parent, node.getMatrix() ?? IDENTITY);
    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION");
        if (!pos) continue;
        const uvAcc = prim.getAttribute("TEXCOORD_0");
        const mat = prim.getMaterial();
        const indices = prim.getIndices();
        const count = indices ? indices.getCount() : pos.getCount();
        const getPos = (vi: number): Vec3f => {
          const e = [0, 0, 0];
          pos.getElement(vi, e);
          return transformPoint(world, { x: e[0]!, y: e[1]!, z: e[2]! });
        };
        const getUv = (vi: number): [number, number] | null => {
          if (!uvAcc) return null;
          const e = [0, 0];
          uvAcc.getElement(vi, e);
          return [e[0]!, e[1]!];
        };
        for (let i = 0; i + 2 < count; i += 3) {
          const i0 = indices ? indices.getScalar(i) : i;
          const i1 = indices ? indices.getScalar(i + 1) : i + 1;
          const i2 = indices ? indices.getScalar(i + 2) : i + 2;
          const a = getPos(i0), b = getPos(i1), c = getPos(i2);
          // 代表色は重心 UV のテクセル（無ければ baseColorFactor / グレー）。
          const uv0 = getUv(i0), uv1 = getUv(i1), uv2 = getUv(i2);
          const cuv: [number, number] | null = uv0 && uv1 && uv2
            ? [(uv0[0] + uv1[0] + uv2[0]) / 3, (uv0[1] + uv1[1] + uv2[1]) / 3]
            : null;
          const color = await texColor(mat, cuv);
          tris.push({ a, b, c, color });
        }
      }
    }
    for (const child of node.listChildren()) await walk(child, world);
  }

  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (scene) {
    for (const node of scene.listChildren()) await walk(node, IDENTITY);
  }
  return tris;
}

async function loadMesh(file: string): Promise<ColoredTri[]> {
  if (/\.obj$/i.test(file)) return parseObj(readFileSync(file, "utf8"));
  if (/\.(glb|gltf)$/i.test(file)) return parseGlb(file);
  throw new Error(`未対応のメッシュ拡張子です: ${file}`);
}

// ---- グリッド合わせ・色伝播・GridIR 化 ----

function aabbOf(tris: ColoredTri[]): { min: Vec3f; max: Vec3f } {
  const min: Vec3f = { x: Infinity, y: Infinity, z: Infinity };
  const max: Vec3f = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const t of tris) {
    for (const p of [t.a, t.b, t.c]) {
      min.x = Math.min(min.x, p.x); min.y = Math.min(min.y, p.y); min.z = Math.min(min.z, p.z);
      max.x = Math.max(max.x, p.x); max.y = Math.max(max.y, p.y); max.z = Math.max(max.z, p.z);
    }
  }
  return { min, max };
}

function fitToGrid(aabb: { min: Vec3f; max: Vec3f }, targetHeight: number): GridSpace {
  const sy = Math.max(1e-6, aabb.max.y - aabb.min.y);
  const sx = Math.max(1e-6, aabb.max.x - aabb.min.x);
  const sz = Math.max(1e-6, aabb.max.z - aabb.min.z);
  let voxelSize = sy / Math.max(1, targetHeight);

  const dimsFor = (vs: number): Dims => ({
    w: Math.min(GRID_SIZE_MAX, Math.max(1, Math.ceil(sx / vs))),
    h: Math.min(GRID_SIZE_MAX, Math.max(1, Math.ceil(sy / vs))),
    d: Math.min(GRID_SIZE_MAX, Math.max(1, Math.ceil(sz / vs))),
  });

  // 各次元 ≤ GRID_SIZE_MAX へ。超えるなら voxelSize を上げる。
  let dims = dimsFor(voxelSize);
  let guard = 0;
  while ((Math.ceil(sx / voxelSize) > GRID_SIZE_MAX || Math.ceil(sy / voxelSize) > GRID_SIZE_MAX || Math.ceil(sz / voxelSize) > GRID_SIZE_MAX) && guard++ < 64) {
    voxelSize *= 1.2;
    dims = dimsFor(voxelSize);
  }
  // 総量 ≤ GRID_VOLUME_MAX へ。
  guard = 0;
  while (dims.w * dims.h * dims.d > GRID_VOLUME_MAX && guard++ < 64) {
    voxelSize *= 1.2;
    dims = dimsFor(voxelSize);
  }
  return { min: aabb.min, voxelSize, dims };
}

/** 内部セルの色を、最寄り shell 色から多源 BFS で伝播する。 */
function propagateColors(occupied: Set<number>, shellColor: Map<number, RGB>, dims: Dims): Map<number, RGB> {
  const color = new Map<number, RGB>();
  const queue: number[] = [];
  for (const [cell, rgb] of shellColor) {
    if (occupied.has(cell)) { color.set(cell, rgb); queue.push(cell); }
  }
  const nb: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++]!;
    const [x, y, z] = decodeCell(cur, dims);
    const c = color.get(cur)!;
    for (const [dx, dy, dz] of nb) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (nx < 0 || nx >= dims.w || ny < 0 || ny >= dims.h || nz < 0 || nz >= dims.d) continue;
      const nk = cellIndex(nx, ny, nz, dims);
      if (occupied.has(nk) && !color.has(nk)) { color.set(nk, c); queue.push(nk); }
    }
  }
  return color;
}

/** ColoredTri 群 → GridIR（occupancy.ts の占有を使い、色量子化して詰める）。 */
export function trisToGridIR(tris: ColoredTri[], opts: MeshOptions = {}): GridIR {
  const targetHeight = Math.max(1, Math.round(opts.targetHeight ?? 24));
  const fill: MeshFill = opts.fill ?? "solid";
  const gs = fitToGrid(aabbOf(tris), targetHeight);
  const dims = gs.dims;

  const shellMap = rasterizeShell(tris, gs); // cell → triIndex
  const shellColor = new Map<number, RGB>();
  for (const [cell, ti] of shellMap) shellColor.set(cell, tris[ti]!.color);

  const occupied = fill === "solid" ? fillSolid(shellMap.keys(), dims) : new Set(shellMap.keys());
  const colors = fill === "solid" ? propagateColors(occupied, shellColor, dims) : shellColor;

  const pb = new PaletteBuilder();
  const voxels: number[][][] = Array.from({ length: dims.h }, () =>
    Array.from({ length: dims.d }, () => new Array<number>(dims.w).fill(0)),
  );
  for (const cell of occupied) {
    const [x, y, z] = decodeCell(cell, dims);
    const rgb = colors.get(cell) ?? DEFAULT_COLOR;
    voxels[y]![z]![x] = pb.intern(quantizeLab(rgb[0], rgb[1], rgb[2]));
  }

  return { type: "grid", size: { w: dims.w, h: dims.h, d: dims.d }, voxels, palette: pb.toPalette(), facing: "auto" };
}

/** メッシュファイル → GridIR（v3.1 入口）。 */
export async function meshToGridIR(file: string, opts: MeshOptions = {}): Promise<GridIR> {
  const tris = await loadMesh(file);
  if (tris.length === 0) throw new Error("メッシュに三角形がありません。");
  return trisToGridIR(tris, opts);
}
