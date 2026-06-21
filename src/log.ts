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
