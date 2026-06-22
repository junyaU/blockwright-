/**
 * §5.3 palette / style 解決。
 *
 * 最終的に wall/floor/roof/trim/window が必ず埋まった Palette を得る。
 * - palette 直指定があれば基底、無ければ style プリセット、どちらも無ければ既定 style。
 * - palette と style 両方あれば palette 優先・欠けスロットは style で補完。
 * - trim 未指定 → wall、window 未指定 → minecraft:glass。
 * - 各スロットを resolveMaterial で正規化（trust＋不正形式のみフォールバック）。
 *
 * presets は curated（実在 BE ブロック・R8）なので実質フォールバックは起きない。
 */
import type { Palette } from "./ir.js";
import { resolveMaterial } from "./materials.js";
import { log } from "./log.js";

export const DEFAULT_STYLE = "rustic";

/** named style プリセット（小さく保つ。各値は実在 BE ブロック）。 */
export const PRESETS: Record<string, Palette> = {
  rustic: {
    wall: "minecraft:oak_planks",
    floor: "minecraft:spruce_planks",
    roof: "minecraft:dark_oak_planks",
    trim: "minecraft:oak_log",
    window: "minecraft:glass",
  },
  stone: {
    wall: "minecraft:stone_bricks",
    floor: "minecraft:stone",
    roof: "minecraft:cobblestone",
    trim: "minecraft:chiseled_stone_bricks",
    window: "minecraft:glass",
  },
  modern: {
    wall: "minecraft:white_concrete",
    floor: "minecraft:light_gray_concrete",
    roof: "minecraft:gray_concrete",
    trim: "minecraft:quartz_block",
    window: "minecraft:glass",
  },
};

function nonEmpty(value: string | undefined): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export interface ResolvedPalette {
  palette: Palette; // wall/floor/roof/trim/window すべて埋まった状態
  warnings: string[];
}

/** palette/style を持つ IR（house/tower 等）の共通部分。型に縛られず構造で受ける。 */
export interface PaletteSource {
  palette?: Palette;
  style?: string;
}

export function resolvePalette(src: PaletteSource): ResolvedPalette {
  const warnings: string[] = [];
  const def = PRESETS[DEFAULT_STYLE]!;

  // 明示 style（既知のもののみ）。未知 style は警告。
  let stylePreset: Palette | undefined;
  if (src.style !== undefined) {
    if (PRESETS[src.style]) {
      stylePreset = PRESETS[src.style];
    } else {
      warnings.push(`style "${src.style}" は未知。${src.palette ? "palette/既定" : `既定 "${DEFAULT_STYLE}"`} を使用。`);
    }
  }

  let raw: Palette;
  if (src.palette) {
    // palette 優先・欠けは style→既定で補完。trim 未指定→wall、window 未指定→glass。
    const p = src.palette;
    const wall = nonEmpty(p.wall) ?? stylePreset?.wall ?? def.wall;
    const floor = nonEmpty(p.floor) ?? stylePreset?.floor ?? def.floor;
    const roof = nonEmpty(p.roof) ?? stylePreset?.roof ?? def.roof;
    const trim = nonEmpty(p.trim) ?? stylePreset?.trim ?? wall;
    const window = nonEmpty(p.window) ?? stylePreset?.window ?? "minecraft:glass";
    raw = { wall, floor, roof, trim, window };
  } else {
    const base = stylePreset ?? def;
    raw = {
      wall: base.wall,
      floor: base.floor,
      roof: base.roof,
      trim: base.trim ?? base.wall,
      window: base.window ?? "minecraft:glass",
    };
  }

  // 各スロットを素材検証（v0 §6.3 を流用）。
  const resolveSlot = (label: string, id: string): string => {
    const r = resolveMaterial(id);
    if (r.warning) warnings.push(`${label}: ${r.warning}`);
    return r.material;
  };

  const palette: Palette = {
    wall: resolveSlot("wall", raw.wall),
    floor: resolveSlot("floor", raw.floor),
    roof: resolveSlot("roof", raw.roof),
    trim: resolveSlot("trim", raw.trim!),
    window: resolveSlot("window", raw.window!),
  };
  return { palette, warnings };
}

/**
 * resolvePalette ＋ 警告/解決結果のログ出力をまとめた共通処理。
 * house/tower/wall/bridge のビルダーが先頭で同じ 3 行を書いていた重複を畳む。
 */
export function resolvePaletteLogged(src: PaletteSource): Palette {
  const { palette, warnings } = resolvePalette(src);
  for (const w of warnings) log.warn("palette解決", w);
  log.info("解決palette", palette);
  return palette;
}
