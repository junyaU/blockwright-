/**
 * §6.3 占有判定（純粋幾何・テスト対象）。
 *
 * shell：各三角形を voxel グリッドにバリセントリック・サンプリングで焼き込む。
 * solid：shell 後、境界の空セルから flood-fill で「外側」を求め、占有 = ¬外側（中身詰め）。
 * セルは線形 index（(y*d + z)*w + x）で扱う。voxels[y][z][x] と同じ軸順。
 */

export interface Vec3f {
  x: number;
  y: number;
  z: number;
}

export interface Tri {
  a: Vec3f;
  b: Vec3f;
  c: Vec3f;
}

export interface Dims {
  w: number;
  h: number;
  d: number;
}

export interface GridSpace {
  /** voxel グリッドの原点（AABB 最小角・ワールド座標）。 */
  min: Vec3f;
  /** 1 voxel の一辺（ワールド単位）。 */
  voxelSize: number;
  dims: Dims;
}

export function cellIndex(x: number, y: number, z: number, dims: Dims): number {
  return (y * dims.d + z) * dims.w + x;
}

export function decodeCell(i: number, dims: Dims): [number, number, number] {
  const x = i % dims.w;
  const z = Math.floor(i / dims.w) % dims.d;
  const y = Math.floor(i / (dims.w * dims.d));
  return [x, y, z];
}

function dist(a: Vec3f, b: Vec3f): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** セルを最後に塗った表面サンプル：三角形 index ＋その点のバリセントリック座標。 */
export interface ShellSample {
  ti: number;
  ba: number;
  bb: number;
}

/**
 * 三角形群を shell にラスタライズ。各占有セル → 最後に当たった表面サンプル（triangle index と
 * バリセントリック座標 ba,bb）を返す。呼び出し側はこの点で色（テクスチャ等）をサンプルできる
 * ので、三角形内の細部（目の白等）を取りこぼさない。
 */
export function rasterizeShell(tris: Tri[], gs: GridSpace): Map<number, ShellSample> {
  const { min, voxelSize, dims } = gs;
  const cellOf = (p: Vec3f): number | null => {
    const x = Math.floor((p.x - min.x) / voxelSize);
    const y = Math.floor((p.y - min.y) / voxelSize);
    const z = Math.floor((p.z - min.z) / voxelSize);
    // 1 セル以上外れていたら無視。境界ちょうど（index==dims）は最終セルにクランプして
    // 遠側の面が落ちず shell が閉じるようにする（solid flood-fill の漏れ防止）。
    if (x < 0 || y < 0 || z < 0 || x > dims.w || y > dims.h || z > dims.d) return null;
    const cx = Math.min(x, dims.w - 1);
    const cy = Math.min(y, dims.h - 1);
    const cz = Math.min(z, dims.d - 1);
    return cellIndex(cx, cy, cz, dims);
  };

  const out = new Map<number, ShellSample>();
  for (let ti = 0; ti < tris.length; ti++) {
    const t = tris[ti]!;
    const maxEdge = Math.max(dist(t.a, t.b), dist(t.a, t.c), dist(t.b, t.c));
    const steps = Math.max(1, Math.ceil(maxEdge / (voxelSize * 0.5)));
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps - i; j++) {
        const ba = i / steps;
        const bb = j / steps;
        const bc = 1 - ba - bb;
        const p: Vec3f = {
          x: t.a.x * bc + t.b.x * ba + t.c.x * bb,
          y: t.a.y * bc + t.b.y * ba + t.c.y * bb,
          z: t.a.z * bc + t.b.z * ba + t.c.z * bb,
        };
        const c = cellOf(p);
        if (c !== null) out.set(c, { ti, ba, bb });
      }
    }
  }
  return out;
}

/**
 * shell から solid 占有を作る：境界の空セルから 6 近傍 flood-fill で外側を求め、
 * 占有 = 全セル − 外側（= shell ＋ 内部の閉じた空洞）。
 */
export function fillSolid(shell: Iterable<number>, dims: Dims): Set<number> {
  const shellSet = shell instanceof Set ? shell : new Set(shell);
  const { w, h, d } = dims;
  const outside = new Set<number>();
  const stack: [number, number, number][] = [];

  const seed = (x: number, y: number, z: number): void => {
    const k = cellIndex(x, y, z, dims);
    if (!shellSet.has(k) && !outside.has(k)) {
      outside.add(k);
      stack.push([x, y, z]);
    }
  };
  // 6 面の境界セルを種にする。
  for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) { seed(0, y, z); seed(w - 1, y, z); }
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) { seed(x, 0, z); seed(x, h - 1, z); }
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) { seed(x, y, 0); seed(x, y, d - 1); }

  const nb: [number, number, number][] = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ];
  while (stack.length > 0) {
    const [x, y, z] = stack.pop()!;
    for (const [dx, dy, dz] of nb) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h || nz < 0 || nz >= d) continue;
      const nk = cellIndex(nx, ny, nz, dims);
      if (!shellSet.has(nk) && !outside.has(nk)) {
        outside.add(nk);
        stack.push([nx, ny, nz]);
      }
    }
  }

  const occ = new Set<number>();
  const total = w * h * d;
  for (let i = 0; i < total; i++) if (!outside.has(i)) occ.add(i);
  return occ;
}
