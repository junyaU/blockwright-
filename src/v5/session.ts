/**
 * §6.2 v5 セッション状態。
 *
 * 「現在の対象」（直近に建てた GridIR・origin・region・名前）を 1 つだけ保持する。
 * 修正発話（「それ」「もっと〜」）の参照先になる（FR-72）。
 * v5 は単一対象のみ（複数同時＝シーン合成はスコープ外・§5.2 / R8）。
 * 対象は GridIR のみ（house 等パラメトリックは変形対象でないので積まない）。
 *
 * 確認保留（pendingConfirm）：曖昧・作り直し（regen）の前に確認文を出し、
 * 次の発話（はい/いいえ）で確定/破棄するための保留 EditOp を持つ（§6.5）。
 */
import type { GridIR, Vec3 } from "../ir.js";
import type { EditOp, CurrentMeta } from "./interpret.js";

export interface CurrentObject {
  gridIR: GridIR;
  origin: Vec3;
  region: { min: Vec3; max: Vec3 };
  /** ライブラリ名（cache キーや表示に使う）。 */
  name: string;
  /** 正規化 subject（cache キー）。 */
  subject: string;
}

export interface PendingConfirm {
  op: EditOp;
  /** ユーザーに出した確認文（ログ/再表示用）。 */
  prompt: string;
}

export class SessionState {
  private current: CurrentObject | null = null;
  private pending: PendingConfirm | null = null;

  setCurrent(obj: CurrentObject): void {
    this.current = obj;
    // 新しい対象を建てたら古い確認保留は破棄する。
    this.pending = null;
  }

  getCurrent(): CurrentObject | null {
    return this.current;
  }

  clear(): void {
    this.current = null;
    this.pending = null;
  }

  hasCurrent(): boolean {
    return this.current !== null;
  }

  /**
   * 現在対象から AI に渡すメタ（voxel の占有/座標は渡さない＝R1）。対象が無ければ null。
   * counts は index ごとのブロック数（ヒストグラム）。最多 index ＝主要色（体など）の手がかり。
   * 位置情報ではないので R1 を侵さない（recolor で「体だけ」を近似選択するため・§6.4 / R4）。
   */
  currentMeta(): CurrentMeta | null {
    if (!this.current) return null;
    const ir = this.current.gridIR;
    const counts: Record<number, number> = {};
    for (const layer of ir.voxels) {
      for (const row of layer) {
        for (const idx of row) {
          if (idx !== 0) counts[idx] = (counts[idx] ?? 0) + 1;
        }
      }
    }
    return { size: ir.size, palette: ir.palette, counts };
  }

  setPending(p: PendingConfirm): void {
    this.pending = p;
  }

  getPending(): PendingConfirm | null {
    return this.pending;
  }

  clearPending(): void {
    this.pending = null;
  }
}
