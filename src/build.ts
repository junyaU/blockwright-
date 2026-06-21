/**
 * §6.3 C3: ビルダー build(ir, origin)。
 *
 * ★不変契約★: `build(ir: IR, origin: Vec3): BuildResult` の署名は v0 以降も変えない。
 * IR の表現力を上げるときは、この中の type 分岐（switch）だけを差し替える（付録B）。
 * 呼び出し側・原点解決・Undo・送信はノータッチで育てられる。
 *
 * ここから下流は決定論的であること。座標計算・素材解決の正しさはコードが保証し、
 * AI には絶対に委ねない。
 */
import type { IR, BoxIR, Vec3, BuildResult } from "./ir.js";
import { resolveMaterial } from "./materials.js";
import { buildHouse } from "./house.js";
import { buildTower } from "./tower.js";
import { buildWall } from "./wall.js";
import { buildBridge } from "./bridge.js";
import { buildGrid } from "./grid.js";
import { log } from "./log.js";

/**
 * 1 つの fill コマンドで扱えるブロック数の上限（BE 既定 32768 = 32^3）。
 * これを超える領域は複数コマンドに分割する（FR-10）。
 */
export const FILL_VOLUME_LIMIT = 32768;
/** 分割時の 1 辺の最大長。CHUNK^3 が上限以下になるよう選ぶ。 */
const CHUNK = 32;

/**
 * 箱をプレイヤーの少し前方/横に置くための固定オフセット（v0 は固定値で良い）。
 * origin（プレイヤー絶対座標）に足し込み、プレイヤーを埋めない位置に最小角を置く。
 */
const PLACEMENT_OFFSET: Vec3 = { x: 2, y: 0, z: 2 };

export function coords(v: Vec3): string {
  return `${v.x} ${v.y} ${v.z}`;
}

/** [a, b] を長さ CHUNK 以下の区間に分割する。返すのは各区間の [start, end]（両端含む）。 */
function splitAxis(a: number, b: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let s = a; s <= b; s += CHUNK) {
    out.push([s, Math.min(s + CHUNK - 1, b)]);
  }
  return out;
}

/**
 * min..max のソリッド領域を、体積上限を超えないよう分割した fill コマンド列にする。
 * box・house（geometry 経由）の双方で共用する分割器（FR-10/R7）。
 */
export function fillCommands(min: Vec3, max: Vec3, material: string): string[] {
  const volume = (max.x - min.x + 1) * (max.y - min.y + 1) * (max.z - min.z + 1);
  if (volume <= FILL_VOLUME_LIMIT) {
    return [`fill ${coords(min)} ${coords(max)} ${material}`];
  }
  const cmds: string[] = [];
  for (const [x0, x1] of splitAxis(min.x, max.x)) {
    for (const [y0, y1] of splitAxis(min.y, max.y)) {
      for (const [z0, z1] of splitAxis(min.z, max.z)) {
        cmds.push(`fill ${x0} ${y0} ${z0} ${x1} ${y1} ${z1} ${material}`);
      }
    }
  }
  return cmds;
}

/**
 * 中空の箱を 6 面のソリッドスラブとして構築する。
 * 体積上限を超える hollow（例 64^3）でも、各面は薄板なので確実に上限内に収まる。
 * 辺の重なりは冪等なので問題ない。
 */
function hollowFaces(min: Vec3, max: Vec3, material: string): string[] {
  const faces: Array<[Vec3, Vec3]> = [
    [{ ...min, y: min.y }, { ...max, y: min.y }], // 底
    [{ ...min, y: max.y }, { ...max, y: max.y }], // 天
    [{ ...min, z: min.z }, { ...max, z: min.z }], // 北
    [{ ...min, z: max.z }, { ...max, z: max.z }], // 南
    [{ ...min, x: min.x }, { ...max, x: min.x }], // 西
    [{ ...min, x: max.x }, { ...max, x: max.x }], // 東
  ];
  return faces.flatMap(([fMin, fMax]) => fillCommands(fMin, fMax, material));
}

function buildBox(ir: BoxIR, origin: Vec3): BuildResult {
  const resolved = resolveMaterial(ir.material);
  if (resolved.warning) log.warn("素材解決", resolved.warning);
  const material = resolved.material;

  // 原点解決：プレイヤー絶対座標 + 固定オフセットを最小角とする。
  const min: Vec3 = {
    x: origin.x + PLACEMENT_OFFSET.x,
    y: origin.y + PLACEMENT_OFFSET.y,
    z: origin.z + PLACEMENT_OFFSET.z,
  };
  const max: Vec3 = {
    x: min.x + ir.size.w - 1,
    y: min.y + ir.size.h - 1,
    z: min.z + ir.size.d - 1,
  };

  const volume = ir.size.w * ir.size.d * ir.size.h;

  let commands: string[];
  if (ir.hollow) {
    // 仕様の hollow キーワードは上限内のときに使う。超える場合は 6 面で構築して落ちないようにする。
    commands =
      volume <= FILL_VOLUME_LIMIT
        ? [`fill ${coords(min)} ${coords(max)} ${material} hollow`]
        : hollowFaces(min, max, material);
  } else {
    commands = fillCommands(min, max, material);
  }

  return { region: { min, max }, commands };
}

/**
 * IR を施工コマンド列へ変換する。型分岐はここだけで増やす（呼び出し側は不変）。
 */
export function build(ir: IR, origin: Vec3): BuildResult {
  switch (ir.type) {
    case "box":
      return buildBox(ir, origin);
    case "house":
      return buildHouse(ir, origin);
    case "tower":
      return buildTower(ir, origin);
    case "wall":
      return buildWall(ir, origin);
    case "bridge":
      return buildBridge(ir, origin);
    case "grid":
      return buildGrid(ir, origin);
    default:
      throw new Error(`unknown IR type: ${(ir as { type: string }).type}`);
  }
}
