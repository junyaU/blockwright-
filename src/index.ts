/**
 * 配線（C1〜C4 の結線）。発言 → トリガー判定 → IR 生成 → build → 送信 → Undo 登録。
 *
 * 設計の背骨は IR seam（build）。ここはオーケストレーションだけを担い、
 * 座標計算・素材解決などの正確さは下流（決定論的なコード）に委ねる。
 */
import { MinecraftServer, type PlayerMessageBody } from "./server.js";
import { generateIR } from "./claude.js";
import { build } from "./build.js";
import { planPlacement } from "./geometry.js";
import { UndoManager } from "./undo.js";
import { config } from "./config.js";
import { log } from "./log.js";
import type { BoxIR, HouseIR } from "./ir.js";

const server = new MinecraftServer();
const undo = new UndoManager();

function includesAny(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

async function handleBuild(utterance: string): Promise<void> {
  const state = await server.queryPlayerState();
  if (!state) {
    await server.say("§c座標が取得できませんでした。");
    return;
  }

  const result = await generateIR(utterance);
  if (!result.ok) {
    await server.say(`§c建築に失敗しました: ${result.error}`);
    return;
  }
  if (result.warnings.length > 0) log.warn("IR 警告", result.warnings);
  log.info("生成 IR", result.ir);

  if (result.ir.type === "house") {
    await buildHouseFlow(result.ir, state.pos, state.yaw);
  } else {
    await buildBoxFlow(result.ir, state.pos);
  }
}

/** box：AI 素材を信頼して建て、最初の fill が失敗したらフォールバックで建て直す（v0 方式）。 */
async function buildBoxFlow(ir: BoxIR, origin: { x: number; y: number; z: number }): Promise<void> {
  const { w, d, h } = ir.size;
  let built = build(ir, origin);
  log.info("送信コマンド", built.commands);
  const first = built.commands[0];
  const firstBody = first ? await server.runCommand(first) : { statusCode: 0 };

  if (firstBody?.statusCode !== 0) {
    log.warn("素材が無効の可能性。フォールバックで建て直します。", { material: ir.material, body: firstBody });
    built = build({ ...ir, material: config.fallbackMaterial }, origin);
    for (const cmd of built.commands) await server.runCommand(cmd);
    undo.record(built);
    await server.say(
      `§e「${ir.material}」は使えなかったので ${config.fallbackMaterial} で建てました（${w}x${d}x${h}）。取り消すには「もどして」。`,
    );
    return;
  }

  for (const cmd of built.commands.slice(1)) {
    const body = await server.runCommand(cmd);
    if (body?.statusCode !== 0) log.warn("コマンドが失敗を返しました", { cmd, body });
  }
  undo.record(built);
  await server.say(`§a完成しました（${w}x${d}x${h} / ${ir.material}）。取り消すには「もどして」。`);
}

/** house：プレイヤー前方に配置し、ドアがプレイヤー側を向く向きで決定論生成して送る。 */
async function buildHouseFlow(ir: HouseIR, player: { x: number; y: number; z: number }, yaw: number): Promise<void> {
  // 配置（前方・中央寄せ）と facing（ドアがプレイヤー側）をまとめて決める。
  // IR の座標非保持原則は維持：build へは具体 origin を渡し、facing は方位 enum。
  const explicit = ir.facing && ir.facing !== "auto" ? ir.facing : undefined;
  const { origin, facing } = planPlacement(player, yaw, ir.footprint.w, ir.footprint.d, explicit);
  ir.facing = facing;
  log.info("配置/facing 解決", { yaw, facing, origin });

  const built = build(ir, origin);
  log.info("送信コマンド数", built.commands.length);
  for (const cmd of built.commands) {
    const body = await server.runCommand(cmd);
    if (body?.statusCode !== 0) log.warn("コマンドが失敗を返しました", { cmd, body });
  }
  undo.record(built);

  const { w, d } = ir.footprint;
  await server.say(`§a家を建てました（${w}x${d} / ${ir.roof}屋根 / 正面:${facing}）。取り消すには「もどして」。`);
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
