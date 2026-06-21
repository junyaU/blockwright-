# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 現状

v0（歩く骨格）実装済み・実機で動作確認済み（2026-06-21）。チャットで「家を建てて」等 → Claude が box IR を生成 → プレイヤー付近に箱が建ち、「もどして」で取り消せる、までの 1 本のループが通っている。

- **正典**：`RequirementsV0.md`（v0 の詳細仕様）。`RequirementsV1.md` は次段の構想。設計判断で迷ったらまず仕様を読む。
- **主要コマンド**（すべて動作確認済み）：
  - `npm start` … 本番起動（WS サーバーを `0.0.0.0:<PORT>` で待受）
  - `npm run spike` … WS 疎通実験スパイク（プロトコル検証用 `src/spike.ts`。本実装前の挙動確認に使う）
  - `npm test` … Vitest（決定論的コアの単体テスト。Minecraft 不要）
  - `npm run typecheck` … `tsc --noEmit`
- **要セットアップ**：`.env` に `ANTHROPIC_API_KEY`（`.env.example` 参照、コミット禁止）。Minecraft（チート有効ワールド）から `/connect <WSL host>:<PORT>`。WSL2 ネットワークの注意点は後述。

## このプロジェクトとは

ゲーム内チャット → Claude が意図を構造化 → 決定論的なコードがそれを Minecraft Bedrock の実ブロックに変換する。v0 のゴールは 1 本のループを最後まで通すこと：**「建ててと言う → 目の前に箱が建つ → 取り消せる」**。見た目の豪華さは明示的にスコープ外。

## アーキテクチャ：IR seam が背骨

```
[1] 入力           [2] AI            [3] IR            [4] build()         [5] 設置
チャット発言   ───▶ Claude API  ───▶ 中間表現      ───▶ コマンド変換   ───▶ MCへ送信
(PlayerMessage)    意図を構造化      (JSON)             座標 / 素材        (WebSocket)
                                     ★契約境界★        決定論的
```

設計全体が [3] の **IR（中間表現）** に懸かっている。IR は AI の賢さ（上流）とコードの正確さ（下流）を分離する契約境界（seam）。コンポーネントは 4 つ：

- **C1 WebSocket サーバー** — Minecraft の `/connect` を待ち受け、イベントを購読し、コマンドを送る。
- **C2 Claude クライアント** — チャット発言を IR の JSON だけに変換する（それ以外を出力させない）。
- **C3 `build(ir, origin)`** — IR を `fill` コマンドに変換し、原点を解決し、素材を検証する。決定論的。
- **C4 Undo マネージャ** — 設置した領域を記録し、`minecraft:air` で埋め戻す。

## 不変条件 — 破ってはならない（これが v0 の眼目）

1. **`build(ir: IR, origin: Vec3): BuildResult` は固定署名。** 表現力は `build()` の中の `type` 分岐を増やして育てる（box → grid → house）。呼び出し側・原点解決・Undo・送信はノータッチのまま。`RequirementsV0.md` §2.3, §5, 付録B。
2. **AI に生の `setblock`/`fill` 文字列を吐かせない。** AI が出すのは IR のみ。AI 生成のコマンド文字列を中継する実装は禁止（施工エンジンが無い＝後で全書き直しになる）。
3. **IR は絶対座標を持たない。** 「何を建てるか」（サイズ・素材）だけを表し、「どこに」は持たない。場所は `origin` 引数で与えるので、同じ IR をどこにでも建てられる。
4. **[4][5] は決定論的。** 座標計算と素材解決はコードの責務であり、AI には絶対に委ねない。
5. **単一の失敗でプロセス全体を落とさない。** API・パース・コマンド・WS 切断の失敗は捕捉し、ユーザーにゲーム内チャットでフィードバックする。無言で失敗しない。
6. **素材は「信頼してから施工時フォールバック」。** Minecraft の有効ブロックは膨大なので allowlist で弾かない。形式が妥当な ID は AI を信頼してそのまま使い、施工時に Minecraft が拒否（`statusCode≠0`）したらフォールバック素材（既定 `minecraft:stone`）で建て直す＝Minecraft 自身を最終バリデータにする。JE→BE エイリアスは補正。例外で全体を止めない。実装は `src/materials.ts`（正規化・エイリアス）＋ `src/index.ts` の `handleBuild`（施工時フォールバック）。
7. **スコープ厳守。** §4.2「やらないこと」（grid/house IR、画像入力、建物タイプ複数化、ブロック単位の完全 Undo、マルチプレイヤー、永続化）は、簡単に見えても実装しない。将来への投資をしてよい唯一の場所は IR seam だけ。

## IR スキーマ（v0）

`IR` は `type` で判別する判別可能ユニオン。v0 は `box` のみ。将来 `grid`/`house` を seam に触れず追加できる形で定義する。

```ts
type Vec3 = { x: number; y: number; z: number };
type IR = BoxIR; // 将来: BoxIR | GridIR | HouseIR

interface BoxIR {
  type: "box";
  size: { w: number; d: number; h: number }; // 整数、各 1..64
  material: string;                            // BE ブロック ID、検証対象
  hollow?: boolean;                            // 省略時 false
}

interface BuildResult {
  region: { min: Vec3; max: Vec3 }; // 絶対座標、Undo 用
  commands: string[];               // 送信したコマンド、ログ用
}
```

Claude の出力をパースして IR にする。パース失敗・スキーマ不一致時は **施工せず**、チャットでユーザーに通知する（§6.2 に従いリトライ 1 回が先）。

## このスタック固有の既知リスク（実装方針を固める前に検証すること）

Minecraft の WebSocket プロトコルは **非公式**（Code Connection 由来）でバージョン差分がある。仕様の指示：思い込みで作り込む前に、**まず疎通実験**でイベント購読とコマンド実行が実際に効くことを確認する（`RequirementsV0.md` §11, 付録A）。下記は当初の懸念で、次節「確定した WS プロトコル」で実測により解決済み：

- **相対座標 `~ ~ ~` がプレイヤーに解決しないことがある。** プレイヤーの絶対座標を問い合わせ、それを基準に施工する。問い合わせ手段は疎通実験で確定する。
- **`fill` に体積上限がある。** 複数 `fill` に分割するかサイズをクランプする（64³ の箱は上限を超え得る）。
- **WSL2 のネットワークが最大のハマりどころ。** WS サーバーは `0.0.0.0:<port>` にバインド必須（`127.0.0.1` 固定にしない）。Windows から到達するには mirrored networking（または WSL IP 直結）に加え、ループバック例外の一度きりの登録が要る（`CheckNetIsolation LoopbackExempt -a -n="Microsoft.MinecraftUWP_8wekyb3d8bbwe"`）。これを誤ると症状は「無言の接続失敗」。詳細は §3.2。

## 確定した WS プロトコル（疎通実験で確認済み・2026-06-21）

`src/spike.ts` での実測で以下を確定。実装はこの実形に従う（付録A の想定形ではなくこちらが正）。

- **暗号化セッション必須**。未暗号で `subscribe` すると `statusMessage:"暗号化されたセッションが必要です"`（statusCode `-2147418107`）で拒否される。接続直後に `enableEncryption` ハンドシェイクが必要（`src/encryption.ts`）。
  - 曲線は **secp384r1 (P-384)**。公開鍵は X.509 SPKI(DER) を base64 で授受。
  - 鍵導出：`key = SHA256(salt(16B) || ECDH共有秘密)`（32B）、`IV = key[0:16]`、暗号は **AES-256-CFB8**。
  - CFB8 はストリーム暗号なので cipher/decipher はセッション中**同一インスタンスを使い回す**（メッセージ毎に作り直さない）。
  - ハンドシェイク応答は `header.messagePurpose:"ws:encrypt"`、`body.publicKey` に Minecraft 側公開鍵。**平文テキストで重複して届く**ことがある。
- **フレーム種別で平文/暗号を判定する**。暗号文は**バイナリ**フレーム、平文 JSON は**テキスト**フレーム。`ws` の `message` の第2引数 `isBinary` で分岐する（`enabled` フラグで分岐しない — 暗号化確立後にも平文応答が届くため）。
- **`PlayerMessage` の構造**：`header.eventName === "PlayerMessage"`、`header.messagePurpose === "event"`。本文は **`body.message`**、送信者は **`body.sender`**、種別は `body.type`（`"chat"`）。※`eventName` は body ではなく **header** にある。
- **プレイヤー絶対座標**：`querytarget @s` を実行 → `commandResponse` の **`body.details` は JSON 文字列**（二重パースが必要）→ 配列 `[0].position {x,y,z}`（float）と `yRot`。ブロック座標へは `Math.floor` する。y は負値もありうる（地下世界）。
  - ⚠ **`position.y` は足元ではなく目線(eye)位置**を返す（実測：足元 -60 のとき y=-58.38 ≈ -60 + 1.62）。足元に直すには `y - 1.62` してから floor する（補正しないと建物が約1ブロック浮く）。x/z は水平なので補正不要。
- **コマンド成否**：`commandResponse` の `body.statusCode`（0 が成功）、`fill` は `body.fillCount` を返す。
- 相対座標 `~` も `origin:{type:"player"}` で解決した（実測で fill 成功）。ただし Undo の領域記録に絶対座標が要るため、施工は `querytarget` の絶対座標基準で行う方針は維持する。

## スタック & 構成（実装済み）

Node.js v20+ / TypeScript（`tsx` で実行、`tsc` で型チェック）。サーバーに `ws`、Claude に `@anthropic-ai/sdk`、`requestId` に `crypto.randomUUID()`（メッセージ毎に UUIDv4）、設定に `dotenv`、テストに `vitest`。既定モデルは `claude-sonnet-4-6`（`MODEL` 環境変数で差し替え可）。

`src/` 構成：
- `index.ts` … 配線・トリガー判定・施工時フォールバック（`handleBuild`/`handleUndo`）
- `server.ts` … C1 WS サーバー（暗号化・購読・`runCommand`・`queryPlayerPosition`・`say`）
- `encryption.ts` … WS 暗号化（secp384r1 + AES-256-CFB8）
- `claude.ts` … C2 発言→IR（JSON のみ・フェンス除去・リトライ1回）
- `ir.ts` … IR 型・`parseIR`（検証/クランプ）
- `build.ts` … C3 `build(ir, origin)`・`fill` 体積分割・hollow（面分割含む）
- `materials.ts` … 素材正規化・JE→BE エイリアス
- `undo.ts` … C4 領域 Undo
- `config.ts` … 設定（port/apiKey/model/トリガー語/Undo語/フォールバック素材）
- `log.ts` … ロガー
- `spike.ts` … 疎通実験スパイク（プロトコル検証用に保持）

外出し設定：ポート（既定 19131）、`ANTHROPIC_API_KEY`（`.env`、コミット禁止 — `.gitignore` 済み）、モデル名。トリガー語（漢字＋ひらがな）／Undo語／フォールバック素材は `config.ts`。

## ロギングは必須要件

WS API が非公式なため、デバッグはログに依存する。最低限ログに出すもの：(a) 送受信した全 WS メッセージ、(b) 生成した IR、(c) 送信したコマンド、(d) 素材フォールバック等の警告。info/warn/error のレベル分けを使う。
