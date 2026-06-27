/**
 * §6.4/§6.5 v6 曖昧/同定不能ポリシー（無言失敗禁止・FR-90/91・原則10）。
 *
 * 固有のリファレンスを確信を持って同定できなかったときの振る舞いを決める。
 * - "notify"（既定）：理由を通知して停止（黙って変なものを建てない）。
 * - "flat"：最良候補で v4 を試行（破綻時は v4 既存の平面フォールバックへ）。router が buildFromImage を供給。
 *
 * ★パラメトリック降格は固有には使わない（原則6 違反＝箱になる・R8）。型ありジェネリックは
 *   そもそも route が parametric に振り分けるため、ここでの降格は不要。
 * I/O（say・建築）は deps 経由で注入し、このモジュールは判断だけに保つ（テスト容易）。
 */
import { log } from "../log.js";

export interface UnidentifiedDeps {
  /** 同定不能時のポリシー（config.v6UnidentifiedPolicy）。 */
  policy: "notify" | "flat";
  /** 通知用の対象名（チャット表示）。 */
  subject: string;
  /** ゲーム内チャット通知。 */
  say(text: string): Promise<void>;
  /** "flat" 用：最良候補画像から建てる（成功で true）。router が obtain+placeAsCurrent を供給。 */
  buildFromImage?(path: string): Promise<boolean>;
}

/**
 * 参照を同定できなかったときの後始末。bestImagePath は確信は無いが取得できた最良候補（無ければ null）。
 * "flat" かつ候補ありなら試行し、失敗時は通知に落とす。"notify"（既定）は常に通知して停止。
 */
export async function handleUnidentified(
  bestImagePath: string | null,
  deps: UnidentifiedDeps,
): Promise<void> {
  log.warn("リファレンス同定不能", {
    subject: deps.subject,
    policy: deps.policy,
    hasCandidate: bestImagePath !== null,
  });

  if (deps.policy === "flat" && bestImagePath && deps.buildFromImage) {
    const ok = await deps.buildFromImage(bestImagePath);
    if (ok) {
      log.info("同定不能 → 最良候補で建築（flat ポリシー）", { subject: deps.subject });
      return;
    }
    log.warn("最良候補での建築に失敗、通知に落とす", { subject: deps.subject });
  }

  await deps.say(
    `§e「${deps.subject}」の参照画像を特定できませんでした。別の言い方や、画像での指定を試してください。`,
  );
}
