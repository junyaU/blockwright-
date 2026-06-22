/**
 * §2.2 ローカル建物空間 → ワールド空間 変換。
 *
 * 幾何を facing から独立させるため、全形状を **ローカル空間**で組む：
 *   lx∈[0,w-1], lz∈[0,d-1], ly∈[0,屋根頂]。**正面壁 = lz=0**。
 * 最後に facing でこのローカル座標を Y 軸 90° 単位回転し、origin で平行移動してワールド化する。
 *
 * ★最頻バグ源（R2）：90° 回転で fill の min/max 角が入れ替わる。
 *   fill 領域は両角を変換した後に必ず min/max を再計算する（点は個別変換）。
 */
import type { Vec3, Facing } from "./ir.js";
import { fillCommands, coords } from "./build.js";

/** ローカル空間での施工指示（fill 領域 or 単一ブロック）。 */
export type LocalOp =
  | { kind: "fill"; min: Vec3; max: Vec3; material: string }
  | { kind: "point"; pos: Vec3; material: string };

/** 家をプレイヤーの前に置くときの、近い面までの間隔（ブロック）。 */
const FRONT_GAP = 3;

/** 各 facing の単位方向ベクトル（Bedrock: +X=east, +Z=south）。 */
const DIR: Record<Facing, { dx: number; dz: number }> = {
  north: { dx: 0, dz: -1 },
  south: { dx: 0, dz: 1 },
  east: { dx: 1, dz: 0 },
  west: { dx: -1, dz: 0 },
};
const OPPOSITE: Record<Facing, Facing> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
};

/** ir.facing を具体方位へ解決する。"auto"/未指定は建物タイプ既定（fallback）に倒す。 */
export function resolveFacing(facing: Facing | "auto" | undefined, fallback: Facing): Facing {
  return facing && facing !== "auto" ? facing : fallback;
}

/** Bedrock yaw → プレイヤーが向いている 4 方位（規約は R6・実機確認）。 */
export function lookFromYaw(yaw: number): Facing {
  const y = ((yaw % 360) + 360) % 360;
  if (y >= 315 || y < 45) return "south"; // yaw 0 ≈ +Z
  if (y < 135) return "west"; //             yaw 90 ≈ -X
  if (y < 225) return "north"; //            yaw 180 ≈ -Z
  return "east"; //                          yaw 270 ≈ +X
}

/**
 * プレイヤーの前方に家を置くための「原点（footprint 最小角）」と facing を決める。
 * - facing は明示があればそれ、無ければ「プレイヤーの向きの反対」＝ドアがプレイヤー側を向く。
 * - 家はプレイヤーの視線方向に FRONT_GAP だけ前へ、左右は中央寄せで配置する。
 */
export function planPlacement(
  player: Vec3,
  yaw: number,
  w: number,
  d: number,
  explicitFacing?: Facing,
): { origin: Vec3; facing: Facing } {
  const look = lookFromYaw(yaw);
  const facing = explicitFacing ?? OPPOSITE[look]; // ドアがプレイヤー側を向く
  // ワールドでの footprint 寸法（N/S は w×d、E/W は回転で入れ替わる）。
  const extX = facing === "north" || facing === "south" ? w : d;
  const extZ = facing === "north" || facing === "south" ? d : w;
  const lv = DIR[look];
  const alongExt = lv.dx !== 0 ? extX : extZ; // 視線方向の奥行き
  const centerX = player.x + lv.dx * (FRONT_GAP + alongExt / 2);
  const centerZ = player.z + lv.dz * (FRONT_GAP + alongExt / 2);
  return {
    origin: { x: Math.round(centerX - extX / 2), y: player.y, z: Math.round(centerZ - extZ / 2) },
    facing,
  };
}

/**
 * ローカル (lx, lz) を facing に応じて回転した世界 (x, z) デルタにする。
 * 4 方位すべて proper rotation（鏡映しない）。正面 lz=0 が facing 方向を向く。
 * footprint w/d は反転定数に使う（overhang で範囲外になっても線形に正しく写る）。
 */
function rotateXZ(lx: number, lz: number, w: number, d: number, facing: Facing): { x: number; z: number } {
  switch (facing) {
    case "north":
      return { x: lx, z: lz }; // 正面 lz=0 → -Z
    case "south":
      return { x: w - 1 - lx, z: d - 1 - lz }; // 180°、正面 → +Z
    case "west":
      return { x: lz, z: w - 1 - lx }; // 正面 → -X
    case "east":
      return { x: d - 1 - lz, z: lx }; // 正面 → +X
  }
}

/** ローカル座標をワールド座標へ（回転＋origin 平行移動）。origin は footprint の最小角。 */
export function toWorld(local: Vec3, facing: Facing, origin: Vec3, w: number, d: number): Vec3 {
  const r = rotateXZ(local.x, local.z, w, d, facing);
  return {
    x: origin.x + r.x,
    y: origin.y + local.y,
    z: origin.z + r.z,
  };
}

export interface TransformResult {
  commands: string[];
  region: { min: Vec3; max: Vec3 };
}

/**
 * ローカル op 列を facing でワールド化し、コマンド列と全体 AABB（Undo 用）を返す。
 * fill は両角変換→min/max 再計算→体積分割。point は setblock。
 * 建物タイプ非依存（house/tower 等が共用する）。
 */
export function transformBuilding(
  ops: LocalOp[],
  facing: Facing,
  origin: Vec3,
  w: number,
  d: number,
): TransformResult {
  const commands: string[] = [];
  let min: Vec3 | null = null;
  let max: Vec3 | null = null;
  const track = (v: Vec3): void => {
    if (min === null || max === null) {
      min = { ...v };
      max = { ...v };
      return;
    }
    min = { x: Math.min(min.x, v.x), y: Math.min(min.y, v.y), z: Math.min(min.z, v.z) };
    max = { x: Math.max(max.x, v.x), y: Math.max(max.y, v.y), z: Math.max(max.z, v.z) };
  };

  for (const op of ops) {
    if (op.kind === "fill") {
      const a = toWorld(op.min, facing, origin, w, d);
      const b = toWorld(op.max, facing, origin, w, d);
      const fmin: Vec3 = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) };
      const fmax: Vec3 = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) };
      commands.push(...fillCommands(fmin, fmax, op.material));
      track(fmin);
      track(fmax);
    } else {
      const p = toWorld(op.pos, facing, origin, w, d);
      commands.push(`setblock ${coords(p)} ${op.material}`);
      track(p);
    }
  }

  return { commands, region: { min: min ?? { ...origin }, max: max ?? { ...origin } } };
}
