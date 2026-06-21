/**
 * §6.4 色 → ブロック量子化（決定論コア）。
 *
 * buildable block 代表色テーブル（blocks.json／full・opaque・solid・非重力のみ／FR-54）を
 * Lab 空間で最近傍マッチして、サンプル色に最も近いブロックを選ぶ（FR-53/R6）。
 * PaletteBuilder は量子化で実際に使われたブロックのみを index 化（realized palette／FR-55）。
 */
import { readFileSync } from "node:fs";
import { srgbToLab, deltaE, type Lab } from "./color.js";

interface BlockColor {
  id: string;
  rgb: [number, number, number];
  lab: Lab;
}

function loadTable(): BlockColor[] {
  const raw = JSON.parse(
    readFileSync(new URL("./blocks.json", import.meta.url), "utf8"),
  ) as { id: string; rgb: [number, number, number] }[];
  return raw.map((b) => ({ id: b.id, rgb: b.rgb, lab: srgbToLab(b.rgb[0], b.rgb[1], b.rgb[2]) }));
}

const TABLE: BlockColor[] = loadTable();

/** sRGB(0..255) を代表色テーブルの最近傍（Lab 距離）ブロック ID へ量子化する。 */
export function quantizeLab(r: number, g: number, b: number): string {
  const lab = srgbToLab(r, g, b);
  let best = TABLE[0]!;
  let bestD = Infinity;
  for (const e of TABLE) {
    const dd = deltaE(lab, e.lab);
    if (dd < bestD) {
      bestD = dd;
      best = e;
    }
  }
  return best.id;
}

/** realized palette（実使用ブロックのみ）を作る。index 0 は air 予約。 */
export class PaletteBuilder {
  private map = new Map<string, number>();
  private next = 1;

  /** ブロック ID を index 化（既出なら同じ index、新規なら連番付与）。 */
  intern(blockId: string): number {
    const existing = this.map.get(blockId);
    if (existing !== undefined) return existing;
    const idx = this.next;
    this.next += 1;
    this.map.set(blockId, idx);
    return idx;
  }

  /** index → ブロック ID の辞書（GridIR.palette 用。0 は含まない）。 */
  toPalette(): Record<number, string> {
    const pal: Record<number, string> = {};
    for (const [id, idx] of this.map) pal[idx] = id;
    return pal;
  }
}

/** テーブルの全ブロック ID（テスト/検証用）。 */
export function tableIds(): string[] {
  return TABLE.map((e) => e.id);
}
