/**
 * §6.1 C1: WebSocket サーバー。
 *
 * Minecraft からの /connect を待ち受け、暗号化ハンドシェイク（§11 R1）を行い、
 * PlayerMessage を購読し、コマンドを送る。spike.ts で確定した実形に従う。
 *
 * 提供する API（上位＝index.ts が使う）：
 *   - onPlayerMessage(handler): 発言イベントを受け取る
 *   - runCommand(commandLine): コマンドを送り、commandResponse の body を待つ
 *   - queryPlayerPosition(): querytarget @s で絶対座標（floor 済み）を得る
 *   - say(text): ゲーム内チャットにフィードバックを出す
 */
import { WebSocketServer, type WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import type { Vec3 } from "./ir.js";
import { config } from "./config.js";
import { log } from "./log.js";
import { Encryption } from "./encryption.js";

/** PlayerMessage の body（実測の構造）。 */
export interface PlayerMessageBody {
  message: string;
  sender: string;
  receiver: string;
  type: string;
}

type CommandResolver = (body: any) => void;
const COMMAND_TIMEOUT_MS = 5000;

export class MinecraftServer {
  private wss?: WebSocketServer;
  private ws?: WebSocket;
  private enc?: Encryption;
  /** requestId → commandResponse を待っている解決関数。 */
  private readonly pending = new Map<string, CommandResolver>();
  private readonly messageHandlers: Array<(body: PlayerMessageBody) => void> = [];

  start(): void {
    this.wss = new WebSocketServer({ host: "0.0.0.0", port: config.port });
    log.info(`WS サーバー起動。0.0.0.0:${config.port} で待受中。Minecraft で /connect <host>:${config.port}`);
    this.wss.on("connection", (ws) => this.handleConnection(ws));
    this.wss.on("error", (err) => log.error("WSServer エラー", String(err)));
  }

  onPlayerMessage(handler: (body: PlayerMessageBody) => void): void {
    this.messageHandlers.push(handler);
  }

  private handleConnection(ws: WebSocket): void {
    log.info("Minecraft が接続しました。暗号化ハンドシェイクを開始します。");
    this.ws = ws;
    const enc = new Encryption();
    this.enc = enc;

    // enableEncryption を平文で送る（応答の公開鍵で暗号化を確立する）。
    this.sendPlain(ws, {
      header: {
        version: 1,
        requestId: randomUUID(),
        messageType: "commandRequest",
        messagePurpose: "commandRequest",
      },
      body: { version: 1, commandLine: enc.enableCommand(), origin: { type: "player" } },
    });

    ws.on("message", (data: Buffer, isBinary: boolean) => this.handleMessage(data, isBinary));
    ws.on("close", () => {
      log.info("Minecraft 接続が切断されました。再接続を待ちます。");
      this.cleanup(ws);
    });
    ws.on("error", (err) => log.error("WS エラー", String(err)));
  }

  private cleanup(ws: WebSocket): void {
    if (this.ws === ws) {
      this.ws = undefined;
      this.enc = undefined;
    }
    // 保留中のコマンドは解決されないので、待ち手を解放する。
    for (const [id, resolve] of this.pending) {
      resolve({ statusCode: -1, statusMessage: "接続が切断されました" });
      this.pending.delete(id);
    }
  }

  private handleMessage(data: Buffer, isBinary: boolean): void {
    const enc = this.enc;
    let raw: string;
    if (isBinary) {
      if (!enc) return;
      try {
        raw = enc.decrypt(data);
      } catch (e) {
        log.error("復号に失敗", String(e));
        return;
      }
    } else {
      raw = data.toString("utf8");
    }
    log.info(isBinary ? "WS受信(復号)" : "WS受信(平文)", raw);

    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      log.warn("JSON パース不可", raw.slice(0, 120));
      return;
    }

    // 暗号化確立：公開鍵を受けて鍵導出 → PlayerMessage 購読。
    if (enc && !enc.enabled && msg?.body?.publicKey) {
      try {
        enc.complete(msg.body.publicKey);
        log.info("暗号化を確立しました。PlayerMessage を購読します。");
        this.send({
          header: {
            version: 1,
            requestId: randomUUID(),
            messageType: "commandRequest",
            messagePurpose: "subscribe",
          },
          body: { eventName: "PlayerMessage" },
        });
      } catch (e) {
        log.error("暗号化確立に失敗", String(e));
      }
      return;
    }

    const purpose = msg?.header?.messagePurpose;

    if (purpose === "event" && msg?.header?.eventName === "PlayerMessage") {
      const body = msg.body as PlayerMessageBody;
      for (const handler of this.messageHandlers) {
        try {
          handler(body);
        } catch (e) {
          log.error("PlayerMessage ハンドラで例外", String(e));
        }
      }
      return;
    }

    if (purpose === "commandResponse") {
      const id = msg?.header?.requestId;
      const resolve = id ? this.pending.get(id) : undefined;
      if (resolve && id) {
        this.pending.delete(id);
        resolve(msg.body);
      }
    }
  }

  /** コマンドを送り、commandResponse の body を待つ。タイムアウト時も落とさない。 */
  runCommand(commandLine: string): Promise<any> {
    const ws = this.ws;
    const enc = this.enc;
    if (!ws || !enc?.enabled) {
      return Promise.resolve({ statusCode: -1, statusMessage: "未接続" });
    }
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(requestId)) {
          log.warn("コマンド応答がタイムアウトしました", commandLine);
          resolve({ statusCode: -1, statusMessage: "タイムアウト" });
        }
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(requestId, (body) => {
        clearTimeout(timer);
        resolve(body);
      });
      this.send({
        header: {
          version: 1,
          requestId,
          messageType: "commandRequest",
          messagePurpose: "commandRequest",
        },
        body: { version: 1, commandLine, origin: { type: "player" } },
      });
    });
  }

  /**
   * querytarget @s でプレイヤー絶対座標（足元）を得る（ブロック座標へ floor）。失敗時は null。
   *
   * ⚠ querytarget の position.y は足元ではなく**目線(eye)位置**を返す（実測で確定：
   * 平地で足元 -60 のとき y=-58.38 ≈ -60 + 1.62）。eye 高さ分を引いて足元に直す。
   */
  async queryPlayerPosition(): Promise<Vec3 | null> {
    const body = await this.runCommand("querytarget @s");
    if (!body || body.statusCode !== 0 || typeof body.details !== "string") {
      log.warn("座標取得に失敗", body);
      return null;
    }
    try {
      const arr = JSON.parse(body.details);
      const pos = arr?.[0]?.position;
      if (!pos) return null;
      const PLAYER_EYE_HEIGHT = 1.62;
      return {
        x: Math.floor(pos.x),
        y: Math.floor(pos.y - PLAYER_EYE_HEIGHT),
        z: Math.floor(pos.z),
      };
    } catch (e) {
      log.warn("details のパースに失敗", String(e));
      return null;
    }
  }

  /** ゲーム内チャットにフィードバックを出す（§8: 無言で失敗しない）。 */
  async say(text: string): Promise<void> {
    await this.runCommand(`say ${text}`);
  }

  private send(payload: unknown): void {
    const ws = this.ws;
    const enc = this.enc;
    if (!ws) return;
    const json = JSON.stringify(payload);
    if (enc?.enabled) {
      log.info("WS送信(暗号化)", json);
      ws.send(enc.encrypt(json));
    } else {
      this.sendPlain(ws, payload);
    }
  }

  private sendPlain(ws: WebSocket, payload: unknown): void {
    const json = JSON.stringify(payload);
    log.info("WS送信(平文)", json);
    ws.send(json);
  }
}
