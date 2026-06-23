# blockwright

> **ゲーム内チャットで話しかけると、Minecraft の世界に建物が建つ。**
> 自然言語を Claude が意図に構造化し、決定論的なコードが Minecraft Bedrock の実ブロックへ変換する AI 建築システム。

![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-339933?logo=nodedotjs&logoColor=white)
![Minecraft](https://img.shields.io/badge/Minecraft-Bedrock-62B47A)
![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)

---

## 🎮 これは何？

Minecraft Bedrock のチャットに **「家を建てて」** と打つと、目の前に家が出現する。
**「もどして」** で消え、**「右に回して」「大きくして」** で直せる。

肝は役割分担：

- **言葉の解釈**は Claude（AI）が担当
- **座標・幾何・ブロック配置**はすべて決定論的なコードが担当

この境界（**IR seam**）が設計の背骨で、v0 から v5 まで `build(ir, origin)` の署名を一度も変えずに表現力だけを拡張してきた。

## ✨ 主な機能

| 機能 | 例 | 説明 |
|---|---|---|
| 🏗️ 自然言語で建築 | 「石の家を建てて」「橋を架けて」 | 家・塔・壁・橋・箱をパラメトリック生成 |
| ↩️ Undo | 「もどして」 | 直前の建築を撤去 |
| 🔧 会話的修正 (v5) | 「回転」「反転」「大きく」「右に動かして」 | 現在の対象を決定論的に変形 |
| 🧱 自由形状 (v3+) | 画像 / 3Dモデル | 決定論ボクセル化で `grid` 化 |
| 🗣️ 喋るだけ生成 (v4・任意) | 「○○を作って」 | 画像検索 → 3D生成 → ボクセル化（要APIキー・ローカル限定） |

## 🧭 アーキテクチャ：IR seam が背骨

```
チャット → [AI] 意図を構造化 → [IR] 中間表現 → build(ir, origin) → コマンド → Minecraft(WS)
            上流（賢さ）          ★契約境界★       決定論（正確さ）
```

- **IR（中間表現）** が、AI の賢さ（上流）とコードの正確さ（下流）を分離する契約境界。
- **AI が触れるのは言語・分類だけ**（座標・幾何・voxel 占有には一切触れない）。関与点はわずか 3 か所：
  - `claude.ts` … 発話 → パラメトリック IR
  - `pipeline/intent.ts` … 発話を character / parametric に分類
  - `v5/interpret.ts` … 修正発話 → 編集操作に分類
- **IR は絶対座標を持たない**（「何を」だけ。「どこに」は `origin` 引数で外から与える）。

> 設計の全原則は [docs/DESIGN_PRINCIPLES.md](docs/DESIGN_PRINCIPLES.md) を参照。

## 🌱 進化の軌跡（v0 → v5）

| 版 | 追加したもの |
|---|---|
| v0 | `box`（最小ループ：建てる → 建つ → 消せる） |
| v1 | `house`（床・壁・ドア・窓・屋根・向き自動） |
| v2 / v2.x | `tower` / `wall` / `bridge`（パラメトリック構造物の拡充） |
| v3 | ボクセル化エンジン（画像・3Dモデル → `grid`） |
| v4 | 喋るだけ生成（画像検索 → 3D生成 → ボクセル化） |
| v5 | ライブラリ（建造物が貯まる）＋ 会話的修正ループ（直せる） |

いずれも **seam の「上流」に層を足しただけ**で、下流（座標・配置・Undo・送信）は不変。各版の要件は [docs/](docs/) に。

## 🛠️ 技術スタック

- **言語 / 実行**：TypeScript 5.7（[tsx](https://github.com/privatenumber/tsx) で実行・`tsc` で型チェック）/ Node.js 20+（ESM）
- **WebSocket**：[`ws`](https://github.com/websockets/ws)（Minecraft との通信サーバー）
- **AI**：[`@anthropic-ai/sdk`](https://github.com/anthropics/anthropic-sdk-typescript)（Claude）
- **ボクセル化**：[`jimp`](https://github.com/jimp-dev/jimp)（画像）/ [`@gltf-transform/core`](https://gltf-transform.dev/)（glTF / glb）
- **テスト**：[Vitest](https://vitest.dev/)（Minecraft 不要の決定論コアをユニットテスト）

## 🚀 セットアップ

### 前提
- Node.js 20 以上
- Minecraft Bedrock（**チート有効**のワールド）
- WSL2 で動かす場合はネットワーク設定（後述）

### インストール
```bash
git clone https://github.com/junyaU/blockwright-.git
cd blockwright-
npm install
cp .env.example .env   # ANTHROPIC_API_KEY を設定
```

### 環境変数（`.env`）
| 変数 | 必須 | 効果 |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | Claude。未設定だと建築時に失敗 |
| `PORT` | | WS ポート（既定 19131） |
| `MODEL` | | IR 生成モデル（既定 `claude-sonnet-4-6`） |
| `SERPAPI_API_KEY` | | 設定すると v4 キャラ生成が有効化（任意） |
| `MESHY_API_KEY` | | image→3D（任意・未設定なら平面生成にフォールバック） |
| `DEFAULT_CHARACTER_HEIGHT` | | サイズ無指定キャラの高さ（既定 48） |

### 起動 & 接続
```bash
npm start            # WS サーバーを 0.0.0.0:<PORT> で待受
```
Minecraft のチャットから接続：
```
/connect <ホスト>:<PORT>
```

> **⚠️ WSL2 の注意**：WS は `0.0.0.0` バインド必須。Windows から到達するには mirrored networking（または WSL IP 直結）に加え、ループバック例外の一度きりの登録が要る：
> ```powershell
> CheckNetIsolation LoopbackExempt -a -n="Microsoft.MinecraftUWP_8wekyb3d8bbwe"
> ```
> 誤ると症状は「無言の接続失敗」になる。

## 💬 ゲーム内コマンド

| 種類 | 言い方の例 |
|---|---|
| 建築 | `建てて` / `作って` / `架けて` / `build` |
| Undo | `もどして` / `戻して` / `undo` |
| 修正 (v5) | `なおして` / `反転` / `回転` / `動かして` / `大きく` / `小さく` |
| 開発用注入（LLM を通さない） | `!grid <name>` / `!voxelize <file> <size>` |

（トリガー語の定義は [`src/config.ts`](src/config.ts)）

## 🧪 開発

```bash
npm test          # Vitest（決定論コアのユニットテスト・Minecraft 不要）
npm run typecheck # tsc --noEmit
npm run dev       # ホットリロード
npm run spike     # WS プロトコル疎通スパイク
```

## 📁 プロジェクト構成

```
.
├── src/          # 実装（seam/core・builders・pipeline(v4)・v5・voxelize・infra）
├── docs/         # 設計原則・各版の要件
├── assets/       # ボクセル化の入力リファレンス（生成物はローカル限定）
├── fixtures/     # テスト/開発用の grid
├── CLAUDE.md     # AI エージェント（Claude Code）向けガイド
└── README.md     # ← 本ファイル（人間向け）
```

## 🔍 技術的に難しかった点（見どころ）

- **非公式 WebSocket プロトコルのリバースエンジニアリング**：Minecraft Bedrock の WS API は非公式。暗号化セッション必須（secp384r1 + AES-256-CFB8）、プレイヤー座標は目線位置で返る（足元へ −1.62 補正）、`querytarget` の応答は二重 JSON…といった実測仕様を `spike` で確定させてから実装した。
- **AI と決定論の境界設計（IR seam）**：AI に生コマンドや座標を出させず、IR と分類だけに限定。施工の正確さを決定論コードに閉じ込め、AI の不確実性を建築品質から切り離した。
- **素材は「信頼してから施工時フォールバック」**：膨大な有効ブロックを allowlist で弾かず、Minecraft 自身を最終バリデータにして、拒否時のみ石で建て直す。

## 📚 ドキュメント

- [docs/DESIGN_PRINCIPLES.md](docs/DESIGN_PRINCIPLES.md) — 設計 10 原則
- [docs/](docs/) — 各版（v0〜v5）の要件
- [CLAUDE.md](CLAUDE.md) — AI エージェント向けの作業ガイド

---

<sub>個人開発・ポートフォリオプロジェクト。Minecraft は Mojang / Microsoft の商標です。</sub>
