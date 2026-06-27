# CLAUDE.md — blockwright

ゲーム内チャット → Claude が意図を構造化 → 決定論コードが Minecraft Bedrock の実ブロックに変換する
AI 建築システム。設計の背骨は `build(ir, origin)`（**IR seam**）一本。
設計思想の正典は `docs/DESIGN_PRINCIPLES.md`（10 原則）。各版の要件は `docs/RequirementsV0〜V6.md`。

## コマンド
| 用途 | コマンド |
|---|---|
| 本番起動（WS を `0.0.0.0:<PORT>` で待受） | `npm start` |
| ホットリロード開発 | `npm run dev` |
| 型チェック | `npm run typecheck` |
| テスト（Vitest・Minecraft 不要の決定論コア） | `npm test` |
| WS 疎通スパイク（プロトコル検証） | `npm run spike` |

**ゲーム内**（チート有効ワールドから `/connect <WSL host>:<PORT>`／語の定義は `config.ts`）：
- 建築：`建てて`/`作って`/`架けて`/`build` 等（triggerWords）。v6：発話を 固有/ジェネリック/曖昧 に分類し、固有は参照識別→生成、ジェネリック型ありはパラメトリックへ自動振り分け（入口は1つのまま）
- Undo：`もどして`/`戻して`/`undo` 等（undoWords）
- v5 修正：`なおして`/`反転`/`回転`/`動かして`/`大きく`/`小さく` 等（editWords）→ 現在対象を修正
- dev 注入（LLM を通さない）：`!grid <name>`（fixtures/grid/）、`!voxelize <file>`（assets/）

## セットアップ / 環境変数（`.env`・コミット禁止。`.env.example` 参照）
| 変数 | 必須 | 効果 |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | Claude。未設定だと建築時に明示失敗（spike は不要） |
| `PORT` | | WS ポート（既定 19131） |
| `MODEL` | | IR 生成モデル（既定 `claude-sonnet-4-6`） |
| `SERPAPI_API_KEY` | | **設定すると v4/v6 の生成経路が有効化**。未設定なら「作って」はパラメトリック経路のみ（v6 ルーターもスキップ） |
| `MESHY_API_KEY` | | image→3D。未設定/失敗時は v3.0 平面建築にフォールバック |
| `DEFAULT_CHARACTER_HEIGHT` | | サイズ無指定キャラの高さ（既定 48、grid 軸上限 64） |
| `V6_AMBIGUITY_POLICY` | | v6 曖昧/低信頼の経路：`generation`（既定・生成寄り）/`confirm`（1問確認） |
| `V6_UNIDENTIFIED_POLICY` | | v6 固有の参照同定不能時：`notify`（既定・通知して停止）/`flat`（最良候補で試行） |
| `V6_CLASSIFY_CONFIDENCE` | | v6 分類信頼度しきい値（既定 0.6・未満は曖昧扱い） |
| `V6_REF_CANDIDATES` | | v6 リファレンス識別で取得・検証する候補数（既定 8） |
| `V6_REF_MIN_SCORE` | | v6 vision 採用スコアしきい値 0..1（既定 0.6・固有=strict は底上げ） |
| `VISION_MODEL` | | v6 vision 検証モデル（未設定なら `MODEL` 流用） |

**WSL2 の最重要ハマり**：WS は `0.0.0.0` バインド必須（`127.0.0.1` 固定にしない）。Windows から
到達するには mirrored networking（または WSL IP 直結）＋ループバック例外の一度きり登録：
`CheckNetIsolation LoopbackExempt -a -n="Microsoft.MinecraftUWP_8wekyb3d8bbwe"`
誤ると症状は「無言の接続失敗」。

## アーキテクチャ：IR seam が背骨
```
チャット → [AI] 意図を構造化 → [IR] 中間表現 → build(ir,origin) → コマンド → MC(WS)
            上流（賢さ）          ★契約境界★      決定論（正確さ）
```
v0〜v6 すべて **seam の上流に層を足しただけ**で、`build(ir, origin)` の署名は一度も変えていない。
AI が関与するのは次の 4 点だけ（言語・分類・vision 判定のみ／座標・幾何・voxel 占有には触れない）：
1. `claude.ts` — 発話 → パラメトリック IR（box/house/tower/wall/bridge）
2. `v6/classify.ts` — 発話を 固有/ジェネリック/曖昧 に分類（v6・`pipeline/intent.ts` の character/parametric 2分類を入口で置換。intent.ts は残置）
3. `v5/interpret.ts` — フォローアップ発話 → EditOp 分類（v5）
4. `v6/reference.ts` — 候補画像を vision で一致/単体/クリーン/正面 検証・再ランク（v6・**画像の選別のみ**。形は v4 `generate3D` だけが作る）

## 不変条件（破ってはならない — 根拠と全 10 原則は `docs/DESIGN_PRINCIPLES.md`）
1. **`build(ir, origin): BuildResult` は固定署名。** 表現力は `build.ts` の `switch` に型分岐を足して育てる。下流（座標・配置・Undo・送信）は再実装しない。
2. **AI に生 `setblock`/`fill`/座標/voxel 占有を出させない。** AI が出すのは IR と分類だけ。
3. **IR は絶対座標を持たない。** 「何を」だけ。「どこに」は `origin` 引数で外から与える。
4. **座標・幾何・素材解決は決定論コードの責務。** AI に委ねない。
5. **単一の失敗で全体を落とさない。** API/パース/コマンド/WS 切断は捕捉し、ゲーム内チャットで通知。無言で失敗しない。
6. **素材は信頼してから施工時フォールバック**（allowlist で弾かない）。形式が妥当なら使い、MC が拒否（`statusCode≠0`）したら `minecraft:stone` で建て直す。`materials.ts`＋`index.ts`。

## IR スキーマ（判別可能ユニオン・`ir.ts`）
`type IR = BoxIR | HouseIR | TowerIR | WallIR | BridgeIR | GridIR`
- `box` size+material+hollow? / `house` footprint+roof+door+windows / `tower` +cap(battlement) /
  `wall` length+crenellation+gate / `bridge` span+railing+piers /
  `grid` size+voxels[y][z][x]+palette（自由形状。v4/v5 のキャラはすべてここに合流）
- `BuildResult = { region:{min,max:Vec3}, commands:string[] }`（絶対座標・Undo 用）
- パース失敗時は**施工せず**チャット通知（リトライ 1 回が先）。検証/クランプは `parseIR`。

## モジュール地図
- **seam / core**：`build.ts`(switch分岐・fill体積分割) `ir.ts`(union+parseIR) `geometry.ts`(toWorld/transformBuilding/planPlacement/lookFromYaw) `materials.ts` `palette.ts`(style preset) `undo.ts`
- **builders**：`house.ts` `tower.ts` `wall.ts` `bridge.ts` `grid.ts`（box は build.ts 内）
- **v4 `pipeline/`**（喋るだけでキャラ生成・**個人ローカル限定**）：`intent.ts`→`image.ts`(SerpAPI)→`gen3d.ts`/`adapters/meshy.ts`(image→glb)→`cleanup.ts`→`gate.ts`、束ねは `orchestrate.ts`
- **v5 `v5/`**（貯まる・直せる）：`session.ts`(現在対象+pendingConfirm) `library.ts`(GridIR を `library/*.json.gz`+index で永続化) `interpret.ts`(EditOp分類) `dispatch.ts`(recolor/rescale/mirror/rotate/move=決定論変形, regen=v4再生成, **`placeAsCurrent` を v6 が再利用**) `transform.ts`(純粋変形)
- **v6 `v6/`**（経路ルーター＋リファレンス識別・新規建築の生成元選択のみ。v5 の編集/キャッシュ/削除は不変）：`classify.ts`(固有/ジェネリック/曖昧=AI言語) `route.ts`(decideRoute/resolveParametricType=決定論振り分け) `reference.ts`(正規化→候補→vision検証→最良1枚) `policy.ts`(曖昧/同定不能フォールバック)。出口は parametric IR or GridIR で従来どおり `build()` へ収束。配線は `index.ts` の `routeNewBuild`/`runGeneration`。`orchestrate.ts` は `refImagePath` で識別済み参照を受け取る
- **`voxelize/`**（参照を GridIR 化）：`index.ts`(拡張子振分) `image.ts`(jimp) `mesh.ts`(glTF) `occupancy.ts` `color.ts` `quantize.ts`
- **infra**：`server.ts`(WS/暗号/runCommand/queryPlayerState/say) `encryption.ts` `index.ts`(配線・routing・各flow) `config.ts` `log.ts` `spike.ts`

## 既知の非自明なハマり（コードから推測不能）
- **プレイヤー y は目線位置。** `querytarget @s` の `position.y` は足元+1.62。`y-1.62` してから `floor`（補正しないと約 1 ブロック浮く）。x/z は補正不要、y は負値あり。
- **`querytarget` の `body.details` は JSON 文字列**（二重パース）→ `[0].position`。成否は `commandResponse.body.statusCode`（0=成功）、`fill` は `fillCount`。
- **WS は暗号化セッション必須**：secp384r1 + AES-256-CFB8。CFB8 はストリームなので cipher/decipher を**セッション中使い回す**。暗号文=バイナリ/平文=テキストフレームで判定（`isBinary` を見る／`enabled` フラグでは判定しない）。`PlayerMessage` は `header.eventName`／本文 `body.message`／送信者 `body.sender`。完全な実測仕様は `docs/RequirementsV0.md` §11・付録A と `src/spike.ts`。
- **`fill` に体積上限**：64³ 超は複数 fill に分割（`build.ts` の fillCommands が共用）。
- **回転で fill の角が入れ替わる**：fill は両角を変換後に min/max を再計算（`geometry.ts`。崩れ/欠けの最頻バグ源）。

## ロギングは必須要件（WS API が非公式なため）
最低限：(a) 送受信 WS メッセージ全件、(b) 生成 IR、(c) 送信コマンド、(d) 素材フォールバック等の警告。info/warn/error を使い分ける（`log.ts`）。
