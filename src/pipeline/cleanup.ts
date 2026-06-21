/**
 * §6.4 ④ 正規化/清掃（決定論・荒さ吸収層）。
 *
 * 生成3D（stage3）の荒さを ⑤ボクセル化が安全に食える形へ整える。すべて決定論：
 *   - 再センタリング：AABB 中心を原点へ。
 *   - 最大連結成分の抽出：頂点共有でつながらない浮遊片を捨て、主要部のみ残す（AC-41）。
 * スケール正規化は ⑤の fitToGrid(targetHeight) が担うのでここではしない。
 * 向き補正は Meshy 出力が Y-up 前提でベストエフォート（完全自動は不可・R2）＝本版では未実施。
 *
 * ★形は作らない（生成は stage3 のみ）。ここは既存形状の整理だけ。
 */
import type { ColoredTri } from "../voxelize/mesh.js";

interface Bounds {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

function bounds(tris: ColoredTri[]): Bounds {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const t of tris) {
    for (const p of [t.a, t.b, t.c]) {
      min.x = Math.min(min.x, p.x); min.y = Math.min(min.y, p.y); min.z = Math.min(min.z, p.z);
      max.x = Math.max(max.x, p.x); max.y = Math.max(max.y, p.y); max.z = Math.max(max.z, p.z);
    }
  }
  return { min, max };
}

/** Union-Find（連結成分用）。 */
class DSU {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    let r = x;
    while (this.parent[r] !== r) r = this.parent[r]!;
    while (this.parent[x] !== r) { const next = this.parent[x]!; this.parent[x] = r; x = next; }
    return r;
  }
  union(a: number, b: number): void {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

/** 頂点を共有する三角形を連結し、最大連結成分のインデックス集合を返す。 */
export function largestComponent(tris: ColoredTri[]): Set<number> {
  if (tris.length === 0) return new Set();
  // 頂点量子化のための quantum（bbox 対角の 1e-5、最低 1e-6）。
  const b = bounds(tris);
  const diag = Math.hypot(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
  const q = Math.max(1e-6, diag * 1e-5);
  const key = (p: { x: number; y: number; z: number }): string =>
    `${Math.round(p.x / q)},${Math.round(p.y / q)},${Math.round(p.z / q)}`;

  const dsu = new DSU(tris.length);
  const vertexToTri = new Map<string, number>();
  for (let i = 0; i < tris.length; i++) {
    for (const p of [tris[i]!.a, tris[i]!.b, tris[i]!.c]) {
      const k = key(p);
      const prev = vertexToTri.get(k);
      if (prev === undefined) vertexToTri.set(k, i);
      else dsu.union(prev, i);
    }
  }

  const counts = new Map<number, number>();
  for (let i = 0; i < tris.length; i++) {
    const r = dsu.find(i);
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  let bestRoot = -1, bestCount = -1;
  for (const [root, c] of counts) {
    if (c > bestCount) { bestCount = c; bestRoot = root; }
  }
  const keep = new Set<number>();
  for (let i = 0; i < tris.length; i++) if (dsu.find(i) === bestRoot) keep.add(i);
  return keep;
}

/** 三角形群を AABB 中心が原点に来るよう平行移動する。 */
export function recenter(tris: ColoredTri[]): ColoredTri[] {
  if (tris.length === 0) return tris;
  const b = bounds(tris);
  const cx = (b.min.x + b.max.x) / 2;
  const cy = (b.min.y + b.max.y) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  const shift = (p: { x: number; y: number; z: number }) => ({ x: p.x - cx, y: p.y - cy, z: p.z - cz });
  // 位置だけ平行移動。color/uv/tex は保持する（uv/tex を落とすと voxel 色が代表色＝
  // Meshy の白い baseColorFactor にフォールバックし、全体が真っ白になる）。
  return tris.map((t) => ({ ...t, a: shift(t.a), b: shift(t.b), c: shift(t.c) }));
}

/** 浮遊片を捨て（最大連結成分のみ）、再センタリングする。 */
export function cleanupMesh(tris: ColoredTri[]): ColoredTri[] {
  const keep = largestComponent(tris);
  const main = tris.filter((_, i) => keep.has(i));
  return recenter(main);
}
