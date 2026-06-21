/**
 * Phase 1: WS 疎通実験スパイク（§11 / 付録A）。
 *
 * 【判明済み】この統合版は暗号化セッション必須。未暗号の購読は
 *   statusMessage "暗号化されたセッションが必要です" で拒否される。
 * よって接続直後に enableEncryption ハンドシェイク（src/encryption.ts）を行い、
 * 暗号化を確立してから PlayerMessage を購読する。
 *
 * 確認したい 4 点：
 *   1. /connect で接続が確立するか（確認済み）
 *   2. 暗号化ハンドシェイクが成立し、購読が通るか ★今回の検証対象★
 *   3. PlayerMessage の body の実フィールド名（本文/送信者）
 *   4. querytarget @s の応答構造（プレイヤー絶対座標の取り出し方）と fill の設置
 *
 * 使い方：
 *   npm run spike → Minecraft で /connect <host>:<PORT> → 何か発言
 */
import { WebSocketServer, type WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { log } from "./log.js";
import { Encryption } from "./encryption.js";

function commandMessage(commandLine: string) {
  return {
    header: {
      version: 1,
      requestId: randomUUID(),
      messageType: "commandRequest",
      messagePurpose: "commandRequest",
    },
    body: { version: 1, commandLine, origin: { type: "player" } },
  };
}

function subscribeMessage(eventName: string) {
  return {
    header: {
      version: 1,
      requestId: randomUUID(),
      messageType: "commandRequest",
      messagePurpose: "subscribe",
    },
    body: { eventName },
  };
}

const wss = new WebSocketServer({ host: "0.0.0.0", port: config.port });
log.info(
  `スパイク起動。0.0.0.0:${config.port} で待受中。Minecraft で /connect <host>:${config.port} を実行してください。`,
);

wss.on("connection", (ws) => {
  log.info("Minecraft が接続しました。暗号化ハンドシェイクを開始します。");

  const enc = new Encryption();
  let firedTestCommands = false;

  /** 暗号化が有効なら暗号文(バイナリ)で、無効なら平文で送る。 */
  function send(payload: unknown): void {
    const json = JSON.stringify(payload);
    if (enc.enabled) {
      log.info("WS送信(暗号化) →", json);
      ws.send(enc.encrypt(json));
    } else {
      log.info("WS送信(平文) →", json);
      ws.send(json);
    }
  }

  // 1) enableEncryption を平文で送る。応答(body.publicKey)で暗号化を確立する。
  const enableReqId = randomUUID();
  ws.send(
    JSON.stringify({
      header: {
        version: 1,
        requestId: enableReqId,
        messageType: "commandRequest",
        messagePurpose: "commandRequest",
      },
      body: { version: 1, commandLine: enc.enableCommand(), origin: { type: "player" } },
    }),
  );
  log.info("WS送信(平文) → enableEncryption（公開鍵/salt を送信）");

  ws.on("message", (data: Buffer, isBinary: boolean) => {
    // 暗号文はバイナリフレーム、平文 JSON はテキストフレームで届く。
    // enc.enabled ではなくフレーム種別で判定する（暗号化確立後も
    // enableEncryption の応答が平文テキストで重複して届くため）。
    let raw: string;
    if (isBinary) {
      try {
        raw = enc.decrypt(data);
      } catch (e) {
        log.error("復号に失敗", String(e));
        return;
      }
    } else {
      raw = data.toString("utf8");
    }
    log.info(isBinary ? "WS受信(復号) ←" : "WS受信(平文) ←", raw);

    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      log.warn("JSON パース不可。", raw.slice(0, 200));
      return;
    }

    // 2) enableEncryption の応答：公開鍵を受けて暗号化を確立し、購読する。
    if (!enc.enabled && msg?.body?.publicKey) {
      try {
        enc.complete(msg.body.publicKey);
        log.info("暗号化を確立しました。PlayerMessage を購読します。");
        send(subscribeMessage("PlayerMessage"));
      } catch (e) {
        log.error("暗号化確立に失敗（曲線/形式が違う可能性）", String(e));
      }
      return;
    }

    const purpose = msg?.header?.messagePurpose;

    if (purpose === "error") {
      log.error("Minecraft からエラー応答", msg.body);
      return;
    }

    // 3) 発言イベント。eventName は header にある（疎通実験で確定）。
    if (purpose === "event" && msg?.header?.eventName === "PlayerMessage") {
      log.info("PlayerMessage 受信", msg.body);
      if (!firedTestCommands) {
        firedTestCommands = true;
        send(commandMessage("querytarget @s"));
        send(commandMessage("fill ~1 ~ ~1 ~2 ~1 ~2 minecraft:oak_planks"));
      }
    }

    // 4) コマンド応答（座標/成否の構造を確認）。
    if (purpose === "commandResponse") {
      log.info("commandResponse 受信（座標/成否の構造を確認）", msg.body);
    }
  });

  ws.on("close", () => log.info("Minecraft 接続が切断されました。"));
  ws.on("error", (err) => log.error("WS エラー", String(err)));
});

wss.on("error", (err) => log.error("WSServer エラー", String(err)));
