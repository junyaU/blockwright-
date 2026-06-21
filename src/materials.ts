/**
 * §6.3 素材検証。最終防衛線。
 * AI は JE 名や架空 ID を出しうるので、コード側で allowlist 照合し、
 * よくある JE→BE 名の差を補正し、不明 ID はフォールバックに置換する。
 * ここで例外を投げて全体を止めないこと（FR-09）。
 */
import { config } from "./config.js";

/**
 * 既知 BE ブロック ID の allowlist。
 * すべて namespace 無しの bare 名で持ち、解決時に "minecraft:" を付ける。
 * 色付きブロックは 16 色を機械展開して、定番の建材を一通りカバーする。
 */
const MC_COLORS = [
  "white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
  "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black",
] as const;

const WOOD_TYPES = [
  "oak", "spruce", "birch", "jungle", "acacia", "dark_oak", "mangrove",
  "cherry", "bamboo", "crimson", "warped",
] as const;

const BASE_BLOCKS = [
  // 石・岩
  "stone", "cobblestone", "mossy_cobblestone", "smooth_stone", "stone_bricks",
  "mossy_stone_bricks", "chiseled_stone_bricks", "andesite", "diorite", "granite",
  "polished_andesite", "polished_diorite", "polished_granite",
  "deepslate", "cobbled_deepslate", "polished_deepslate", "deepslate_bricks", "deepslate_tiles",
  "blackstone", "polished_blackstone", "polished_blackstone_bricks",
  "tuff", "calcite", "dripstone_block",
  // 土・自然
  "dirt", "coarse_dirt", "grass_block", "podzol", "sand", "red_sand", "gravel",
  "clay", "mud", "packed_mud", "mud_bricks",
  // レンガ・砂岩・石英
  "bricks", "sandstone", "smooth_sandstone", "cut_sandstone", "chiseled_sandstone",
  "red_sandstone", "smooth_red_sandstone",
  "quartz_block", "smooth_quartz", "quartz_bricks", "chiseled_quartz_block",
  // ガラス・光源・装飾
  "glass", "tinted_glass", "glowstone", "sea_lantern", "shroomlight",
  "bookshelf", "obsidian", "crying_obsidian",
  "prismarine", "prismarine_bricks", "dark_prismarine",
  "nether_bricks", "red_nether_bricks", "end_stone", "end_stone_bricks", "purpur_block",
  "iron_block", "gold_block", "diamond_block", "emerald_block", "lapis_block", "copper_block",
  "hay_block", "snow_block", "packed_ice",
] as const;

const ALLOWLIST = new Set<string>([
  ...BASE_BLOCKS,
  ...MC_COLORS.flatMap((c) => [
    `${c}_concrete`,
    `${c}_concrete_powder`,
    `${c}_wool`,
    `${c}_terracotta`,
    `${c}_stained_glass`,
  ]),
  "terracotta",
  ...WOOD_TYPES.flatMap((w) => [`${w}_planks`, `${w}_log`]),
]);

/**
 * JE 名 → BE 名のエイリアス（必要分のみ）。bare 名で照合する。
 */
const ALIASES: Record<string, string> = {
  grass: "grass_block",
  planks: "oak_planks",
  wood: "oak_log",
  stonebrick: "stone_bricks",
  brick_block: "bricks",
  brick: "bricks",
  glass_pane: "glass",
};

export interface ResolvedMaterial {
  /** 施工に使う完全な BE ブロック ID（"minecraft:" 付き）。 */
  material: string;
  /** フォールバックやエイリアス補正が起きた場合の警告（ログ/通知用）。 */
  warning?: string;
}

/** "minecraft:Oak_Planks" → "oak_planks" のように bare 名へ正規化する。 */
function toBareName(id: string): string {
  const trimmed = id.trim().toLowerCase();
  const colon = trimmed.indexOf(":");
  return colon === -1 ? trimmed : trimmed.slice(colon + 1);
}

/** ブロック ID の bare 名として妥当な形式か（英小文字・数字・アンダースコア）。 */
function isWellFormed(bare: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(bare);
}

/**
 * 素材 ID を正規化・解決する。
 *
 * 方針：Minecraft の有効ブロックは膨大なので allowlist で弾かない。
 * 形式が妥当なら **AI の素材を信頼してそのまま使う**（無効なら施工時に Minecraft が
 * 拒否するので、呼び出し側が statusCode を見てフォールバックする＝最終防衛）。
 * ここでは namespace 正規化と JE→BE エイリアス補正のみ行う。
 * 形式自体が壊れている場合だけ即フォールバックする。
 */
export function resolveMaterial(id: string): ResolvedMaterial {
  const bare0 = toBareName(id);
  const bare = ALIASES[bare0] ?? bare0;

  if (!isWellFormed(bare)) {
    return {
      material: config.fallbackMaterial,
      warning: `不正な素材ID "${id}" をフォールバック "${config.fallbackMaterial}" に置換しました。`,
    };
  }

  const material = `minecraft:${bare}`;
  if (bare !== bare0) {
    return { material, warning: `素材 "${id}" を "${material}" に補正しました（JE→BE エイリアス）。` };
  }
  if (!ALLOWLIST.has(bare)) {
    // 既知ではないが信頼して使う。無効なら施工時にフォールバックされる。
    return { material, warning: `素材 "${material}" は未知（信頼して使用。無効なら施工時に代替）。` };
  }
  return { material };
}
