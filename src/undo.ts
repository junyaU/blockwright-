/**
 * §6.4 C4: Undo マネージャ。
 *
 * 直近の建築領域を 1 段保持し、Undo 語で air 埋め戻しする。
 * ⚠ これは領域単位 Undo であり、建築前の元状態（地形・既存建築）は復元しない。
 * v0 の用途（同じ場所で建て直してテスト）には十分。
 * 将来の完全版（structure block / .mcstructure スナップショット）への置換余地は、
 * build() の裏のチョークポイントとして残す。
 */
import type { BuildResult, Vec3 } from "./ir.js";
import { FILL_VOLUME_LIMIT } from "./build.js";

const CHUNK = 32;

function splitAxis(a: number, b: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let s = a; s <= b; s += CHUNK) out.push([s, Math.min(s + CHUNK - 1, b)]);
  return out;
}

export class UndoManager {
  private last: { min: Vec3; max: Vec3 } | null = null;

  /** 建築結果の領域を Undo 対象として記録する。 */
  record(result: BuildResult): void {
    this.last = result.region;
  }

  hasUndo(): boolean {
    return this.last !== null;
  }

  /**
   * 直近領域を air で埋め戻すコマンド列を返す（体積上限で分割）。
   * 対象が無ければ null。返した後は履歴をクリアする。
   */
  buildUndoCommands(): string[] | null {
    if (!this.last) return null;
    const { min, max } = this.last;
    this.last = null;

    const volume = (max.x - min.x + 1) * (max.y - min.y + 1) * (max.z - min.z + 1);
    if (volume <= FILL_VOLUME_LIMIT) {
      return [`fill ${min.x} ${min.y} ${min.z} ${max.x} ${max.y} ${max.z} minecraft:air`];
    }
    const cmds: string[] = [];
    for (const [x0, x1] of splitAxis(min.x, max.x)) {
      for (const [y0, y1] of splitAxis(min.y, max.y)) {
        for (const [z0, z1] of splitAxis(min.z, max.z)) {
          cmds.push(`fill ${x0} ${y0} ${z0} ${x1} ${y1} ${z1} minecraft:air`);
        }
      }
    }
    return cmds;
  }
}
