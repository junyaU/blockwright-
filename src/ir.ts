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

/** v1: box（v0 不変）に house を追加した判別ユニオン。将来 grid/tower 等を追加可。 */
export type IR = BoxIR | HouseIR;

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

/** 4 方位。"auto" はプレイヤー yaw 由来で具体方位へ解決する（§6.2）。 */
export type Facing = "north" | "south" | "east" | "west";

/** 素材の意味スロット（§5.2）。wall/floor/roof は必須、trim/window は任意。 */
export interface Palette {
  wall: string;
  floor: string;
  roof: string;
  trim?: string;
  window?: string;
}

/**
 * 家（§5.2）。AI はパラメータのみ埋める。座標・幾何は buildHouse が決定論的に生成する。
 * IR は絶対座標を持たない（facing は方位 enum であって座標ではない）。
 */
export interface HouseIR {
  type: "house";
  /** 外形（ブロック数）。各 5..32。 */
  footprint: { w: number; d: number };
  /** 壁の高さ（床上〜軒下）。3..12。 */
  height: number;
  roof: "flat" | "gable";
  /** 軒の張り出し。0..2、既定 1。 */
  roofOverhang?: number;
  door?: {
    /** 正面壁(lz=0)沿いの開口横位置。既定 "center"。数値は 1..w-2 にクランプ。 */
    position?: "center" | number;
  };
  windows?: {
    pattern?: "none" | "even";
    count?: number;
    /** 窓下端の高さ（床からのブロック数）。既定 1。 */
    sill?: number;
  };
  /** palette 直指定 or style 名。両方あれば palette 優先（§5.3）。 */
  palette?: Palette;
  style?: string;
  /** 既定 "auto"（プレイヤー yaw 由来）。build 前に index 側で具体方位へ解決する。 */
  facing?: Facing | "auto";
}

/** build() の返り値。 */
export interface BuildResult {
  /** 設置領域の絶対座標（Undo 用）。 */
  region: { min: Vec3; max: Vec3 };
  /** 送信したコマンド列（ログ/デバッグ用）。 */
  commands: string[];
}

/** box サイズの許容範囲（§5.3）。 */
export const SIZE_MIN = 1;
export const SIZE_MAX = 64;

/** house パラメータの許容範囲（§5.4）。 */
export const FOOTPRINT_MIN = 5;
export const FOOTPRINT_MAX = 32;
export const HEIGHT_MIN = 3;
export const HEIGHT_MAX = 12;
export const OVERHANG_MIN = 0;
export const OVERHANG_MAX = 2;

/** 数値を整数化し min..max にクランプ。範囲外なら warnings に記録。非数値は null。 */
function clampInt(
  value: unknown,
  min: number,
  max: number,
  label: string,
  warnings: string[],
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  const clamped = Math.min(max, Math.max(min, rounded));
  if (clamped !== value) {
    warnings.push(`${label}=${value} を ${clamped} に補正しました（整数 ${min}..${max}）。`);
  }
  return clamped;
}

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
 * 検証前の IR をそのまま施工に渡さないこと（§5.3）。type で box/house に振り分ける。
 */
export function parseIR(raw: unknown): ParseResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "IR がオブジェクトではありません。" };
  }
  const obj = raw as Record<string, unknown>;
  switch (obj.type) {
    case "box":
      return parseBoxIR(obj);
    case "house":
      return parseHouseIR(obj);
    default:
      return { ok: false, error: `未対応の IR type: ${JSON.stringify(obj.type)}（box / house）。` };
  }
}

function parseBoxIR(obj: Record<string, unknown>): ParseResult {
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

/** palette らしきオブジェクトを検証する（各present スロットが非空文字列であること）。 */
function parsePalette(value: unknown, warnings: string[]): Palette | null | "invalid" {
  if (value === undefined) return null;
  if (typeof value !== "object" || value === null) return "invalid";
  const p = value as Record<string, unknown>;
  const slot = (k: string): string | undefined => {
    const v = p[k];
    if (v === undefined) return undefined;
    if (typeof v !== "string" || v.trim() === "") {
      warnings.push(`palette.${k} は文字列ではないため無視しました。`);
      return undefined;
    }
    return v.trim();
  };
  // wall/floor/roof は基底として必須だが、style で補完できるので欠けても許容。
  const wall = slot("wall");
  const floor = slot("floor");
  const roof = slot("roof");
  const trim = slot("trim");
  const window = slot("window");
  // 部分 palette は resolvePalette が style で補完する。ここでは型に合わせ必須3を仮置きし、
  // 欠けは空文字で残して resolve 側に判断させる。
  return {
    wall: wall ?? "",
    floor: floor ?? "",
    roof: roof ?? "",
    ...(trim !== undefined ? { trim } : {}),
    ...(window !== undefined ? { window } : {}),
  };
}

function parseHouseIR(obj: Record<string, unknown>): ParseResult {
  const warnings: string[] = [];

  const fp = obj.footprint;
  if (typeof fp !== "object" || fp === null) {
    return { ok: false, error: "footprint がありません。" };
  }
  const f = fp as Record<string, unknown>;
  const w = clampInt(f.w, FOOTPRINT_MIN, FOOTPRINT_MAX, "footprint.w", warnings);
  const d = clampInt(f.d, FOOTPRINT_MIN, FOOTPRINT_MAX, "footprint.d", warnings);
  if (w === null || d === null) {
    return { ok: false, error: "footprint.w/d は数値である必要があります。" };
  }

  const height = clampInt(obj.height, HEIGHT_MIN, HEIGHT_MAX, "height", warnings);
  if (height === null) {
    return { ok: false, error: "height は数値である必要があります。" };
  }

  let roof: "flat" | "gable";
  if (obj.roof === "flat" || obj.roof === "gable") {
    roof = obj.roof;
  } else {
    roof = "gable";
    if (obj.roof !== undefined) warnings.push(`roof=${JSON.stringify(obj.roof)} は無効。"gable" を使用。`);
  }

  const roofOverhang =
    obj.roofOverhang === undefined
      ? undefined
      : (clampInt(obj.roofOverhang, OVERHANG_MIN, OVERHANG_MAX, "roofOverhang", warnings) ?? undefined);

  // door
  let door: HouseIR["door"];
  if (obj.door !== undefined) {
    if (typeof obj.door !== "object" || obj.door === null) {
      warnings.push("door が不正なため既定（center）を使用。");
    } else {
      const pos = (obj.door as Record<string, unknown>).position;
      if (pos === "center" || pos === undefined) {
        door = { position: "center" };
      } else {
        const clamped = clampInt(pos, 1, Math.max(1, w - 2), "door.position", warnings);
        door = { position: clamped ?? "center" };
      }
    }
  }

  // windows
  let windows: HouseIR["windows"];
  if (obj.windows !== undefined) {
    if (typeof obj.windows !== "object" || obj.windows === null) {
      warnings.push("windows が不正なため既定（even）を使用。");
    } else {
      const wo = obj.windows as Record<string, unknown>;
      const pattern = wo.pattern === "none" || wo.pattern === "even" ? wo.pattern : "even";
      const count =
        wo.count === undefined
          ? undefined
          : (clampInt(wo.count, 0, FOOTPRINT_MAX, "windows.count", warnings) ?? undefined);
      const sill =
        wo.sill === undefined
          ? undefined
          : (clampInt(wo.sill, 0, Math.max(0, height - 1), "windows.sill", warnings) ?? undefined);
      windows = { pattern, ...(count !== undefined ? { count } : {}), ...(sill !== undefined ? { sill } : {}) };
    }
  }

  const palette = parsePalette(obj.palette, warnings);
  if (palette === "invalid") {
    return { ok: false, error: "palette はオブジェクトである必要があります。" };
  }

  let style: string | undefined;
  if (obj.style !== undefined) {
    if (typeof obj.style !== "string") {
      warnings.push("style が文字列でないため無視しました。");
    } else if (obj.style.trim() !== "") {
      style = obj.style.trim();
    }
  }

  let facing: HouseIR["facing"] = "auto";
  if (obj.facing !== undefined) {
    if (["north", "south", "east", "west", "auto"].includes(obj.facing as string)) {
      facing = obj.facing as HouseIR["facing"];
    } else {
      warnings.push(`facing=${JSON.stringify(obj.facing)} は無効。"auto" を使用。`);
    }
  }

  const ir: HouseIR = {
    type: "house",
    footprint: { w, d },
    height,
    roof,
    ...(roofOverhang !== undefined ? { roofOverhang } : {}),
    ...(door !== undefined ? { door } : {}),
    ...(windows !== undefined ? { windows } : {}),
    ...(palette !== null ? { palette } : {}),
    ...(style !== undefined ? { style } : {}),
    facing,
  };
  return { ok: true, ir, warnings };
}
