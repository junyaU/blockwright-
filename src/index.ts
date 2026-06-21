/**
 * 配線（C1〜C4 の結線）。発言 → トリガー判定 → IR 生成 → build → 送信 → Undo 登録。
 *
 * 設計の背骨は IR seam（build）。ここはオーケストレーションだけを担い、
 * 座標計算・素材解決などの正確さは下流（決定論的なコード）に委ねる。
 */
import { MinecraftServer, type PlayerMessageBody } from "./server.js";
import { generateIR } from "./claude.js";
import { build } from "./build.js";
import { UndoManager } from "./undo.js";
import { config } from "./config.js";
import { log } from "./log.js";

const server = new MinecraftServer();
const undo = new UndoManager();

function includesAny(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

async function handleBuild(utterance: string): Promise<void> {
  const origin = await server.queryPlayerPosition();
  if (!origin) {
    await server.say("§c座標が取得できませんでした。");
    return;
  }

  const result = await generateIR(utterance);
  if (!result.ok) {
    await server.say(`§c建築に失敗しました: ${result.error}`);
    return;
  }
  if (result.warnings.length > 0) {
    log.warn("IR 警告", result.warnings);
  }

  log.info("生成 IR", result.ir);
  const { w, d, h } = result.ir.size;

  // まず AI の素材を信頼して建てる。最初の fill が失敗したら（＝無効ブロック等）
  // フォールバック素材で建て直す（Minecraft を最終バリデータにする）。
  let built = build(result.ir, origin);
  log.info("送信コマンド", built.commands);
  const first = built.commands[0];
  const firstBody = first ? await server.runCommand(first) : { statusCode: 0 };

  if (firstBody?.statusCode !== 0) {
    log.warn("素材が無効の可能性。フォールバックで建て直します。", {
      material: result.ir.material,
      body: firstBody,
    });
    built = build({ ...result.ir, material: config.fallbackMaterial }, origin);
    for (const cmd of built.commands) await server.runCommand(cmd);
    undo.record(built);
    await server.say(
      `§e「${result.ir.material}」は使えなかったので ${config.fallbackMaterial} で建てました（${w}x${d}x${h}）。取り消すには「もどして」。`,
    );
    return;
  }

  // 1本目が成功したので残りを送る。
  for (const cmd of built.commands.slice(1)) {
    const body = await server.runCommand(cmd);
    if (body?.statusCode !== 0) log.warn("コマンドが失敗を返しました", { cmd, body });
  }
  undo.record(built);
  await server.say(`§a完成しました（${w}x${d}x${h} / ${result.ir.material}）。取り消すには「もどして」。`);
}

async function handleUndo(): Promise<void> {
  const cmds = undo.buildUndoCommands();
  if (!cmds) {
    await server.say("§e取り消せる建築がありません。");
    return;
  }
  log.info("Undo コマンド", cmds);
  for (const cmd of cmds) {
    await server.runCommand(cmd);
  }
  await server.say("§a直前の建築を取り消しました。");
}

function onMessage(body: PlayerMessageBody): void {
  // 自分の say 等に反応しないよう、プレイヤーのチャットのみ扱う。
  if (body.type !== "chat" || !body.sender) return;

  const text = body.message ?? "";
  log.info("PlayerMessage", { sender: body.sender, message: text });

  // 失敗してもプロセスを落とさない（§8）。各ハンドラ内で例外は握りつぶしてチャット通知。
  if (includesAny(text, config.undoWords)) {
    handleUndo().catch((e) => log.error("Undo 処理で例外", String(e)));
    return;
  }
  if (includesAny(text, config.triggerWords)) {
    handleBuild(text).catch((e) => log.error("建築処理で例外", String(e)));
  }
}

// プロセス全体を単一の失敗で落とさない（§8）。
process.on("uncaughtException", (e) => log.error("uncaughtException", String(e)));
process.on("unhandledRejection", (e) => log.error("unhandledRejection", String(e)));

server.onPlayerMessage(onMessage);
server.start();
log.info(
  `準備完了。トリガー語=${JSON.stringify(config.triggerWords)} / Undo語=${JSON.stringify(config.undoWords)}`,
);
