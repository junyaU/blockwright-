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

/** v2.x: box・house・tower/wall/bridge に grid（自由形状の器）を追加した判別ユニオン。 */
export type IR = BoxIR | HouseIR | TowerIR | WallIR | BridgeIR | GridIR;

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

/** 塔の上部処理（§v2）。"flat"=平天井で蓋、"battlement"=胸壁（交互の merlon）。 */
export type TowerCap = "flat" | "battlement";
/** 塔の断面。v2 は "square" のみ実装。"round" は将来（指定時は square に縮退）。 */
export type TowerShape = "square" | "round";

/**
 * 塔（§v2）。house と同じく AI はパラメータのみ埋め、幾何は buildTower が決定論生成する。
 * house の躯体プリミティブ（床/四方壁/隅柱/ドア開口）を縦方向に再利用する。
 */
export interface TowerIR {
  type: "tower";
  /** 外形（ブロック数）。各 3..16。基本は正方形だが w≠d も許容。 */
  footprint: { w: number; d: number };
  /** 塔身の高さ（床上〜cap 手前）。5..48。 */
  height: number;
  /** 上部処理。既定 "battlement"。 */
  cap?: TowerCap;
  /** 断面形状。既定 "square"。"round" は v2 では square に縮退（警告）。 */
  shape?: TowerShape;
  /** 先細り（将来）。v2 では無視（0 として扱い、非 0 は警告して捨てる）。 */
  taper?: number;
  door?: {
    /** 正面壁(lz=0)沿いの開口横位置。既定 "center"。数値は 1..w-2 にクランプ。 */
    position?: "center" | number;
  };
  windows?: {
    /** "none" | "slit"（縦スリット＝狭間）。既定 "slit"。 */
    pattern?: "none" | "slit";
    /** 各面のスリット本数。省略時は footprint から自動。 */
    count?: number;
    /** スリット下端の高さ（床から）。既定 2。 */
    sill?: number;
    /** スリットの縦の高さ（ブロック数）。既定 3。 */
    span?: number;
  };
  /** palette 直指定 or style 名。両方あれば palette 優先（house と同じ §5.3）。 */
  palette?: Palette;
  style?: string;
  /** 既定 "auto"（プレイヤー yaw 由来）。build 前に index 側で具体方位へ解決する。 */
  facing?: Facing | "auto";
}

/**
 * 防壁（§v2）。長い直線状の壁。AI はパラメータのみ埋め、幾何は buildWall が決定論生成する。
 * ローカル空間：length=長辺(lx)、thickness=厚み(lz)、height=ly。正面=lz=0。
 */
export interface WallIR {
  type: "wall";
  /** 壁の長さ（ブロック数）。5..64。 */
  length: number;
  /** 壁の高さ（床上）。3..16。 */
  height: number;
  /** 壁の厚み。1..4、既定 1。 */
  thickness?: number;
  /** 上部に胸壁（交互の merlon）を付けるか。既定 true。 */
  crenellation?: boolean;
  gate?: {
    /** 通用門の横位置。既定 "center"。数値は端を避けてクランプ。 */
    position?: "center" | number;
    /** 門の幅。1..8、既定 1。 */
    width?: number;
    /** 門の高さ。2..height、既定 min(3, height)。 */
    height?: number;
  };
  palette?: Palette;
  style?: string;
  facing?: Facing | "auto";
}

/**
 * 橋（§v2）。桁（deck）＋欄干＋（任意）橋脚。地面より上に渡す。
 * ローカル空間：span=長辺(lx)、width=幅(lz)、deck=ly=0。正面=lz=0。橋脚は ly<0 へ降ろす。
 */
export interface BridgeIR {
  type: "bridge";
  /** 橋の長さ（スパン）。5..64。 */
  span: number;
  /** 橋の幅。2..16。 */
  width: number;
  /** 両側の欄干を付けるか。既定 true。 */
  railing?: boolean;
  /** 橋脚（下方向の支柱）を付けるか。既定 true。 */
  piers?: boolean;
  palette?: Palette;
  style?: string;
  facing?: Facing | "auto";
}

/**
 * 自由形状の器（§v2.x）。dense voxel をそのまま流し込む。パラメトリック生成器で
 * 表せない不規則オブジェクト用のエスケープハッチ。
 * ★AI には埋めさせない（プロンプトに載せない）。供給はフィクスチャ/開発注入のみ。
 * 次元順序は固定：voxels[y][z][x]（y=下→上, z=正面lz=0→奥, x=列）。0 = 空気（予約）。
 */
export interface GridIR {
  type: "grid";
  /** ブロック寸法。各 1..64。voxels の次元と厳密一致が必要。 */
  size: { w: number; h: number; d: number };
  /** dense voxel data。値は palette への index。0 は air（skip）で予約。 */
  voxels: number[][][];
  /** index → BEブロックID。0 は予約（air）なので含めない。 */
  palette: Record<number, string>;
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

/** tower パラメータの許容範囲（§v2）。house より縦長を許す。 */
export const TOWER_FOOTPRINT_MIN = 3;
export const TOWER_FOOTPRINT_MAX = 16;
export const TOWER_HEIGHT_MIN = 5;
export const TOWER_HEIGHT_MAX = 48;

/** wall パラメータの許容範囲（§v2）。 */
export const WALL_LENGTH_MIN = 5;
export const WALL_LENGTH_MAX = 64;
export const WALL_HEIGHT_MIN = 3;
export const WALL_HEIGHT_MAX = 16;
export const WALL_THICKNESS_MIN = 1;
export const WALL_THICKNESS_MAX = 4;

/** bridge パラメータの許容範囲（§v2）。 */
export const BRIDGE_SPAN_MIN = 5;
export const BRIDGE_SPAN_MAX = 64;
export const BRIDGE_WIDTH_MIN = 2;
export const BRIDGE_WIDTH_MAX = 16;
/** 橋脚の固定の深さ（ブロック数、下方向）。 */
export const BRIDGE_PIER_DEPTH = 4;

/** grid パラメータの許容範囲（§v2.x §6.3）。 */
export const GRID_SIZE_MIN = 1;
export const GRID_SIZE_MAX = 64;
/** 密データ肥大の暴走防止（FR-46）。v4 のキャラ建築で大きめを許すため引き上げ（各次元 ≤64 は別途）。 */
export const GRID_VOLUME_MAX = 200000;

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
    case "tower":
      return parseTowerIR(obj);
    case "wall":
      return parseWallIR(obj);
    case "bridge":
      return parseBridgeIR(obj);
    case "grid":
      return parseGridIR(obj);
    default:
      return { ok: false, error: `未対応の IR type: ${JSON.stringify(obj.type)}（box / house / tower / wall / bridge / grid）。` };
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

function parseTowerIR(obj: Record<string, unknown>): ParseResult {
  const warnings: string[] = [];

  const fp = obj.footprint;
  if (typeof fp !== "object" || fp === null) {
    return { ok: false, error: "footprint がありません。" };
  }
  const f = fp as Record<string, unknown>;
  const w = clampInt(f.w, TOWER_FOOTPRINT_MIN, TOWER_FOOTPRINT_MAX, "footprint.w", warnings);
  const d = clampInt(f.d, TOWER_FOOTPRINT_MIN, TOWER_FOOTPRINT_MAX, "footprint.d", warnings);
  if (w === null || d === null) {
    return { ok: false, error: "footprint.w/d は数値である必要があります。" };
  }

  const height = clampInt(obj.height, TOWER_HEIGHT_MIN, TOWER_HEIGHT_MAX, "height", warnings);
  if (height === null) {
    return { ok: false, error: "height は数値である必要があります。" };
  }

  let cap: TowerCap;
  if (obj.cap === "flat" || obj.cap === "battlement") {
    cap = obj.cap;
  } else {
    cap = "battlement";
    if (obj.cap !== undefined) warnings.push(`cap=${JSON.stringify(obj.cap)} は無効。"battlement" を使用。`);
  }

  // shape: round は v2 未対応のため square に縮退。
  let shape: TowerShape = "square";
  if (obj.shape === "square" || obj.shape === "round") {
    if (obj.shape === "round") warnings.push('shape="round" は v2 未対応。square で建てます。');
  } else if (obj.shape !== undefined) {
    warnings.push(`shape=${JSON.stringify(obj.shape)} は無効。"square" を使用。`);
  }

  // taper: 将来パラメータ。v2 では無視（非 0 は警告して捨てる）。
  if (obj.taper !== undefined && obj.taper !== 0) {
    warnings.push("taper は v2 未対応。0 で建てます。");
  }

  // door（house と同形）
  let door: TowerIR["door"];
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

  // windows（縦スリット）
  let windows: TowerIR["windows"];
  if (obj.windows !== undefined) {
    if (typeof obj.windows !== "object" || obj.windows === null) {
      warnings.push("windows が不正なため既定（slit）を使用。");
    } else {
      const wo = obj.windows as Record<string, unknown>;
      const pattern = wo.pattern === "none" || wo.pattern === "slit" ? wo.pattern : "slit";
      const count =
        wo.count === undefined
          ? undefined
          : (clampInt(wo.count, 0, TOWER_FOOTPRINT_MAX, "windows.count", warnings) ?? undefined);
      const sill =
        wo.sill === undefined
          ? undefined
          : (clampInt(wo.sill, 0, Math.max(0, height - 1), "windows.sill", warnings) ?? undefined);
      const span =
        wo.span === undefined
          ? undefined
          : (clampInt(wo.span, 1, Math.max(1, height), "windows.span", warnings) ?? undefined);
      windows = {
        pattern,
        ...(count !== undefined ? { count } : {}),
        ...(sill !== undefined ? { sill } : {}),
        ...(span !== undefined ? { span } : {}),
      };
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

  let facing: TowerIR["facing"] = "auto";
  if (obj.facing !== undefined) {
    if (["north", "south", "east", "west", "auto"].includes(obj.facing as string)) {
      facing = obj.facing as TowerIR["facing"];
    } else {
      warnings.push(`facing=${JSON.stringify(obj.facing)} は無効。"auto" を使用。`);
    }
  }

  const ir: TowerIR = {
    type: "tower",
    footprint: { w, d },
    height,
    cap,
    shape,
    ...(door !== undefined ? { door } : {}),
    ...(windows !== undefined ? { windows } : {}),
    ...(palette !== null ? { palette } : {}),
    ...(style !== undefined ? { style } : {}),
    facing,
  };
  return { ok: true, ir, warnings };
}

/** style 文字列を検証（非空文字列のみ採用）。共通ヘルパ。 */
function parseStyle(value: unknown, warnings: string[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    warnings.push("style が文字列でないため無視しました。");
    return undefined;
  }
  return value.trim() !== "" ? value.trim() : undefined;
}

/** facing を enum 検証（既定 "auto"）。共通ヘルパ。 */
function parseFacing(value: unknown, warnings: string[]): Facing | "auto" {
  if (value === undefined) return "auto";
  if (["north", "south", "east", "west", "auto"].includes(value as string)) {
    return value as Facing | "auto";
  }
  warnings.push(`facing=${JSON.stringify(value)} は無効。"auto" を使用。`);
  return "auto";
}

function parseWallIR(obj: Record<string, unknown>): ParseResult {
  const warnings: string[] = [];

  const length = clampInt(obj.length, WALL_LENGTH_MIN, WALL_LENGTH_MAX, "length", warnings);
  if (length === null) {
    return { ok: false, error: "length は数値である必要があります。" };
  }
  const height = clampInt(obj.height, WALL_HEIGHT_MIN, WALL_HEIGHT_MAX, "height", warnings);
  if (height === null) {
    return { ok: false, error: "height は数値である必要があります。" };
  }
  const thickness =
    obj.thickness === undefined
      ? undefined
      : (clampInt(obj.thickness, WALL_THICKNESS_MIN, WALL_THICKNESS_MAX, "thickness", warnings) ?? undefined);

  let crenellation = true;
  if (obj.crenellation !== undefined) {
    if (typeof obj.crenellation === "boolean") crenellation = obj.crenellation;
    else warnings.push("crenellation は真偽値である必要があります。既定 true を使用。");
  }

  // gate（通用門）
  let gate: WallIR["gate"];
  if (obj.gate !== undefined) {
    if (typeof obj.gate !== "object" || obj.gate === null) {
      warnings.push("gate が不正なため無視しました。");
    } else {
      const g = obj.gate as Record<string, unknown>;
      let position: "center" | number = "center";
      if (g.position !== undefined && g.position !== "center") {
        const clamped = clampInt(g.position, 1, Math.max(1, length - 2), "gate.position", warnings);
        if (clamped !== null) position = clamped;
      }
      const gw =
        g.width === undefined
          ? undefined
          : (clampInt(g.width, 1, Math.min(8, Math.max(1, length - 2)), "gate.width", warnings) ?? undefined);
      const gh =
        g.height === undefined
          ? undefined
          : (clampInt(g.height, 2, height, "gate.height", warnings) ?? undefined);
      gate = {
        position,
        ...(gw !== undefined ? { width: gw } : {}),
        ...(gh !== undefined ? { height: gh } : {}),
      };
    }
  }

  const palette = parsePalette(obj.palette, warnings);
  if (palette === "invalid") {
    return { ok: false, error: "palette はオブジェクトである必要があります。" };
  }
  const style = parseStyle(obj.style, warnings);
  const facing = parseFacing(obj.facing, warnings);

  const ir: WallIR = {
    type: "wall",
    length,
    height,
    ...(thickness !== undefined ? { thickness } : {}),
    crenellation,
    ...(gate !== undefined ? { gate } : {}),
    ...(palette !== null ? { palette } : {}),
    ...(style !== undefined ? { style } : {}),
    facing,
  };
  return { ok: true, ir, warnings };
}

function parseBridgeIR(obj: Record<string, unknown>): ParseResult {
  const warnings: string[] = [];

  const span = clampInt(obj.span, BRIDGE_SPAN_MIN, BRIDGE_SPAN_MAX, "span", warnings);
  if (span === null) {
    return { ok: false, error: "span は数値である必要があります。" };
  }
  const width = clampInt(obj.width, BRIDGE_WIDTH_MIN, BRIDGE_WIDTH_MAX, "width", warnings);
  if (width === null) {
    return { ok: false, error: "width は数値である必要があります。" };
  }

  let railing = true;
  if (obj.railing !== undefined) {
    if (typeof obj.railing === "boolean") railing = obj.railing;
    else warnings.push("railing は真偽値である必要があります。既定 true を使用。");
  }
  let piers = true;
  if (obj.piers !== undefined) {
    if (typeof obj.piers === "boolean") piers = obj.piers;
    else warnings.push("piers は真偽値である必要があります。既定 true を使用。");
  }

  const palette = parsePalette(obj.palette, warnings);
  if (palette === "invalid") {
    return { ok: false, error: "palette はオブジェクトである必要があります。" };
  }
  const style = parseStyle(obj.style, warnings);
  const facing = parseFacing(obj.facing, warnings);

  const ir: BridgeIR = {
    type: "bridge",
    span,
    width,
    railing,
    piers,
    ...(palette !== null ? { palette } : {}),
    ...(style !== undefined ? { style } : {}),
    facing,
  };
  return { ok: true, ir, warnings };
}

/** 整数 min..max 内か（クランプせず判定のみ。grid は voxels と一致必須なのでクランプ不可）。 */
function intInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function parseGridIR(obj: Record<string, unknown>): ParseResult {
  const warnings: string[] = [];

  // size 検証（クランプではなく拒否：voxels 次元と厳密一致が必要）
  const size = obj.size;
  if (typeof size !== "object" || size === null) {
    return { ok: false, error: "size がありません。" };
  }
  const s = size as Record<string, unknown>;
  if (!intInRange(s.w, GRID_SIZE_MIN, GRID_SIZE_MAX) || !intInRange(s.h, GRID_SIZE_MIN, GRID_SIZE_MAX) || !intInRange(s.d, GRID_SIZE_MIN, GRID_SIZE_MAX)) {
    return { ok: false, error: `size.w/h/d は整数 ${GRID_SIZE_MIN}..${GRID_SIZE_MAX} である必要があります。` };
  }
  const w = s.w as number;
  const h = s.h as number;
  const d = s.d as number;

  if (w * h * d > GRID_VOLUME_MAX) {
    return { ok: false, error: `grid が大きすぎます（${w}x${h}x${d}=${w * h * d} > ${GRID_VOLUME_MAX}）。` };
  }

  // voxels 次元整合（FR-42）。voxels[y][z][x]、全要素が非負整数。
  const voxels = obj.voxels;
  if (!Array.isArray(voxels) || voxels.length !== h) {
    return { ok: false, error: `voxels の y 次元が size.h(${h}) と一致しません。` };
  }
  const usedIndices = new Set<number>();
  for (let y = 0; y < h; y++) {
    const layer = voxels[y];
    if (!Array.isArray(layer) || layer.length !== d) {
      return { ok: false, error: `voxels[${y}] の z 次元が size.d(${d}) と一致しません。` };
    }
    for (let z = 0; z < d; z++) {
      const row = layer[z];
      if (!Array.isArray(row) || row.length !== w) {
        return { ok: false, error: `voxels[${y}][${z}] の x 次元が size.w(${w}) と一致しません。` };
      }
      for (let x = 0; x < w; x++) {
        const cell = row[x];
        if (typeof cell !== "number" || !Number.isInteger(cell) || cell < 0) {
          return { ok: false, error: `voxels[${y}][${z}][${x}] は非負整数である必要があります。` };
        }
        if (cell !== 0) usedIndices.add(cell);
      }
    }
  }

  // palette 検証：voxels に現れる全非 0 index が存在し、各値が非空文字列。
  if (typeof obj.palette !== "object" || obj.palette === null) {
    return { ok: false, error: "palette がありません。" };
  }
  const rawPal = obj.palette as Record<string, unknown>;
  const palette: Record<number, string> = {};
  for (const [k, v] of Object.entries(rawPal)) {
    const idx = Number(k);
    if (!Number.isInteger(idx) || idx < 0) {
      warnings.push(`palette のキー "${k}" は非負整数でないため無視しました。`);
      continue;
    }
    if (idx === 0) {
      warnings.push("palette のキー 0 は air 予約のため無視しました。");
      continue;
    }
    if (typeof v !== "string" || v.trim() === "") {
      warnings.push(`palette[${idx}] が文字列でないため無視しました。`);
      continue;
    }
    palette[idx] = v.trim();
  }
  for (const idx of usedIndices) {
    if (palette[idx] === undefined) {
      return { ok: false, error: `voxels が使う index ${idx} が palette にありません。` };
    }
  }

  const facing = parseFacing(obj.facing, warnings);

  const ir: GridIR = {
    type: "grid",
    size: { w, h, d },
    voxels: voxels as number[][][],
    palette,
    facing,
  };
  return { ok: true, ir, warnings };
}
