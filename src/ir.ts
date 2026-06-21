/**
 * §5 中間表現（IR）★最重要★。
 *
 * IR はこのシステムの背骨。AI 側（賢さ）とコード側（正確さ）を分離する契約境界（seam）。
 * - IR は `type` で判別される判別可能ユニオン。v0 は box のみだが、将来 grid/house を
 *   「追加できる形」で定義する。
 * - IR は絶対座標を持たない。「何を建てるか」だけを表し、「どこに建てるか（origin）」は
 *   build() の引数として外から与える（同じ IR を任意の場所に建てられる）。
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** v0 では Box のみ。将来 BoxIR | GridIR | HouseIR のユニオンに拡張する。 */
export type IR = BoxIR;

export interface BoxIR {
  /** discriminator（将来の分岐キー）。 */
  type: "box";
  /** ブロック数。各 1..64 を許容範囲とする（範囲外はクランプ）。 */
  size: { w: number; d: number; h: number };
  /** BE ブロック ID（例 "minecraft:oak_planks"）。素材検証の対象。 */
  material: string;
  /** 中空にするか。省略時 false（中身も詰まった箱）。 */
  hollow?: boolean;
}

/** build() の返り値。 */
export interface BuildResult {
  /** 設置領域の絶対座標（Undo 用）。 */
  region: { min: Vec3; max: Vec3 };
  /** 送信したコマンド列（ログ/デバッグ用）。 */
  commands: string[];
}

/** サイズの許容範囲（§5.3）。 */
export const SIZE_MIN = 1;
export const SIZE_MAX = 64;

/** パース結果。失敗は例外でなく結果型で返し、呼び出し側がチャット通知できるようにする。 */
export type ParseResult =
  | { ok: true; ir: IR; warnings: string[] }
  | { ok: false; error: string };

function clampSize(value: unknown, axis: string, warnings: string[]): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.round(value);
  const clamped = Math.min(SIZE_MAX, Math.max(SIZE_MIN, rounded));
  if (clamped !== value) {
    warnings.push(`size.${axis}=${value} を ${clamped} に補正しました（整数 ${SIZE_MIN}..${SIZE_MAX}）。`);
  }
  return clamped;
}

/**
 * 任意の値（Claude 出力を JSON.parse したもの等）を検証して IR にする。
 * 検証前の IR をそのまま施工に渡さないこと（§5.3）。
 */
export function parseIR(raw: unknown): ParseResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "IR がオブジェクトではありません。" };
  }
  const obj = raw as Record<string, unknown>;

  if (obj.type !== "box") {
    return { ok: false, error: `未対応の IR type: ${JSON.stringify(obj.type)}（v0 は "box" のみ）。` };
  }

  const size = obj.size;
  if (typeof size !== "object" || size === null) {
    return { ok: false, error: "size がありません。" };
  }
  const s = size as Record<string, unknown>;

  const warnings: string[] = [];
  const w = clampSize(s.w, "w", warnings);
  const d = clampSize(s.d, "d", warnings);
  const h = clampSize(s.h, "h", warnings);
  if (w === null || d === null || h === null) {
    return { ok: false, error: "size.w/d/h は数値である必要があります。" };
  }

  if (typeof obj.material !== "string" || obj.material.trim() === "") {
    return { ok: false, error: "material が空、または文字列ではありません。" };
  }

  if (obj.hollow !== undefined && typeof obj.hollow !== "boolean") {
    return { ok: false, error: "hollow は真偽値である必要があります。" };
  }

  const ir: BoxIR = {
    type: "box",
    size: { w, d, h },
    material: obj.material.trim(),
    hollow: obj.hollow === true,
  };
  return { ok: true, ir, warnings };
}
