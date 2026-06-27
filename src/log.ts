/**
 * 薄いロガー（§8）。WS API が非公式なためデバッグはログに依存する。
 * info/warn/error のレベル分けで、(a)WSメッセージ (b)生成IR (c)送信コマンド
 * (d)素材フォールバック警告 などを記録する。
 */

function ts(): string {
  // new Date() はタイムスタンプ取得に使う（ロギング用途のみ）。
  return new Date().toISOString();
}

function fmt(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const log = {
  info(message: string, detail?: unknown): void {
    const tail = detail === undefined ? "" : " " + fmt(detail);
    console.log(`[${ts()}] INFO  ${message}${tail}`);
  },
  warn(message: string, detail?: unknown): void {
    const tail = detail === undefined ? "" : " " + fmt(detail);
    console.warn(`[${ts()}] WARN  ${message}${tail}`);
  },
  error(message: string, detail?: unknown): void {
    const tail = detail === undefined ? "" : " " + fmt(detail);
    console.error(`[${ts()}] ERROR ${message}${tail}`);
  },
};

/**
 * v7 観測層：stage の所要時間(ms)を計測し `timing` ログに残す（恒久・常時ON）。
 * 「速度」は多義なので、どこが遅いかは推測せず計測する（CONTEXT.md「生成レイテンシ」/ 原則10）。
 *
 * fn を実行して結果をそのまま返す。例外は**握らず再 throw**（フォールバック等の制御フローを壊さない）。
 * `finally` で必ず `{ stage, ms, outcome, ...meta }` を出すので、失敗に費やした時間も取りこぼさない。
 * 計測は呼び出しを**包むだけ**で、build(ir,origin) や各 stage の署名には触れない（ADR 0001）。
 *
 * @param stage  計測点の名前（例 "generate3D"）
 * @param fn     計測対象の非同期処理
 * @param meta   付随ラベル（生成系の mode: "cache-hit"|"3d"|"flat" など）
 */
export async function time<T>(
  stage: string,
  fn: () => Promise<T>,
  meta?: Record<string, unknown>,
): Promise<T> {
  // Date.now() は計時用途のみ（ロギング同様、決定論コアの外）。
  const started = Date.now();
  let outcome: "ok" | "fail" = "ok";
  try {
    return await fn();
  } catch (e) {
    outcome = "fail";
    throw e;
  } finally {
    log.info("timing", { stage, ms: Date.now() - started, outcome, ...(meta ?? {}) });
  }
}
