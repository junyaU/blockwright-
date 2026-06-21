/**
 * Minecraft Bedrock WS の暗号化セッション（§11 R1 で判明）。
 *
 * 新しめの統合版は購読/コマンドの前に暗号化を必須とする
 * （未暗号だと statusMessage "暗号化されたセッションが必要です" で拒否される）。
 *
 * ハンドシェイク：
 *   1. サーバーが EC 鍵ペア（P-256）と 16 バイトの salt を生成。
 *   2. 平文で `enableEncryption "<serverPubKey>" "<salt>"` を送る。
 *   3. Minecraft が応答 body.publicKey に自身の公開鍵を返す。
 *   4. ECDH で共有秘密を計算し、key = SHA256(salt || 共有秘密)（AES-256 の 32 バイト）。
 *   5. IV = key[0:16]。以降の全メッセージを AES-256-CFB8 で暗号化する。
 *
 * CFB8 はストリーム暗号なので、cipher/decipher オブジェクトはセッション中ずっと
 * 同一インスタンスを使い回す（メッセージ毎に作り直さない）。
 *
 * 公開鍵は X.509 SubjectPublicKeyInfo(DER) を base64 で授受する。
 */
import {
  generateKeyPairSync,
  createPublicKey,
  diffieHellman,
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  type KeyObject,
  type Cipher,
  type Decipher,
} from "node:crypto";

/**
 * WS 暗号化に使う楕円曲線。疎通実験で確定：この統合版は secp384r1(P-384)。
 * （Minecraft の公開鍵 OID が 1.3.132.0.34 = secp384r1 だった。P-256 だと
 *  ECDH が "mismatching domain parameters" で失敗する。）
 */
const CURVE = "secp384r1"; // NIST P-384

export class Encryption {
  private readonly privateKey: KeyObject;
  private readonly salt: Buffer;
  readonly publicKeyB64: string;
  readonly saltB64: string;

  private cipher?: Cipher;
  private decipher?: Decipher;
  enabled = false;

  constructor() {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: CURVE });
    this.privateKey = privateKey;
    this.publicKeyB64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
    this.salt = randomBytes(16);
    this.saltB64 = this.salt.toString("base64");
  }

  /** 平文で送る enableEncryption コマンド文字列。 */
  enableCommand(): string {
    return `enableEncryption "${this.publicKeyB64}" "${this.saltB64}"`;
  }

  /** Minecraft 応答の公開鍵(base64 DER SPKI)を受け取り、鍵を導出して暗号化を有効化する。 */
  complete(clientPublicKeyB64: string): void {
    const clientPublic = createPublicKey({
      key: Buffer.from(clientPublicKeyB64, "base64"),
      format: "der",
      type: "spki",
    });
    const shared = diffieHellman({ privateKey: this.privateKey, publicKey: clientPublic });
    const key = createHash("sha256").update(this.salt).update(shared).digest(); // 32 bytes
    const iv = key.subarray(0, 16);
    this.cipher = createCipheriv("aes-256-cfb8", key, iv);
    this.decipher = createDecipheriv("aes-256-cfb8", key, iv);
    this.enabled = true;
  }

  /** 平文 JSON をバイナリ暗号文に変換（送信用）。 */
  encrypt(text: string): Buffer {
    if (!this.cipher) throw new Error("encryption not enabled");
    return this.cipher.update(Buffer.from(text, "utf8"));
  }

  /** バイナリ暗号文を平文 JSON に戻す（受信用）。 */
  decrypt(data: Buffer): string {
    if (!this.decipher) throw new Error("encryption not enabled");
    return this.decipher.update(data).toString("utf8");
  }
}
