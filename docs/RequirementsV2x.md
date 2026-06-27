# 要件定義書：Minecraft統合版 AI建築システム v2.x

> 対象実装者：Claude Code
> 版：v2.x（grid IR ＝ エスケープハッチ）／前提：v0・v1・v2 実装済み
> 言語/環境：Node.js on WSL2、Minecraft Bedrock（Windows）
> 関連：`requirements_minecraft_ai_builder_v0/v1/v2.md`（本書はその差分・拡張）

---

## 0. このドキュメントの読み方（Claude Codeへの前提指示）

- 本書は **v0〜v2への差分**。既存の方針・制約はすべて継続有効。特に以下を**絶対に壊さない**：
  - **`build(ir, origin)` の署名は不変**。grid はレジストリの1エントリとして足すだけ。
  - **IRは絶対座標を持たない**（grid もローカル空間データ。原点は `origin` で外から与える）。
  - v2の **生成器レジストリ**・v1の **ローカル→ワールド変換**・**palette/素材検証**・**fill体積分割**・**Undo全体AABB** を grid でも共用する。
- **v2.x の最重要governance：grid を AI に埋めさせない**（§2・§9 R1）。これが v2.x の存在意義そのもの。grid は当面**テストデータ駆動**で、「誰が grid を埋めるか」は v3（ボクセル化エンジン）で解く別問題として切り離す。
- スコープを広げない。§5.2「やらないこと」厳守。

---

## 1. 背景と目的

v2まではすべて**パラメトリック**（パラメータ→生成関数）で建てた。だが house/tower/wall のような生成関数で表せない**自由形状**（キャラ・ロゴ・不規則オブジェクト）は、セル単位で「置く／置かない」を直接指定するしかない。その**器**が grid IR である。

v2.x のゴールは、**grid という器（ターゲット表現）を正しく定義し、`build()` がそれを正確にブロック展開できることを検証する**こと。**器を埋める手段（充填）はここでは作らない**——それは v3（画像/3Dモデルのボクセル化）に切り離す。v2.x は「器」と「充填手段」を分離して、先に器だけを堅牢に作るフェーズである。

---

## 2. 設計思想：器と充填の分離 ★最重要★

自由形状は「誰が grid を埋めるか」で品質が天と地ほど変わる：

| 充填手段 | 例 | 品質 | 本システムでの扱い |
|---|---|---|---|
| パラメトリック生成 | house/tower | 最良 | v1/v2（grid不要） |
| 決定論ボクセル化（リファレンス有り） | キャラ画像/3Dモデル | 良 | **v3**（grid を埋める正解ルート） |
| AIフリーハンド（想像で埋める） | 「お前が考えた龍」 | 最悪 | **採用しない** |

- **v2.x では grid を「AIフリーハンドで埋める」用途で作らない。** dense voxel を LLM に想像で並べさせると、対称性・丸み・色配置が確実に崩れる（ずっと言ってきた「LLMは3D座標が苦手」の総決算）。
- v2.x の grid 充填源は **手書きの小さなテストフィクスチャ**（階段・対称オブジェクト等のJSON）か、**コード内のテスト用プロシージャ生成**のみ。**LLM経路（chat→Claude→IR）を通さない。**
- したがって v2.x では **AIプロンプトに grid を一切教えない**（§7.1）。AIは引き続き5パラメトリック型のみを出す。grid は開発/テスト経路から直接注入する。

### なぜ「密（dense）」で定義するのか

grid には「疎（少数セルをコードが埋める）」と「密（3D配列を丸ごと流し込む）」の2つの顔がある。v2.x は **最初から密版で器を定義する**。理由：

- **密は疎を表現できる**（空きを index 0 で埋めるだけ）。逆はできない。
- 立体キャラ（v3）は本質的に密。器を疎で作ると v3 で作り直しになる。
- これは v0 で IR seam を先に引いたのと同じ「**継ぎ目を先に正しく置く**」判断。

---

## 3. 実行環境

v0〜v2から変更なし。再掲しない。

---

## 4. アーキテクチャ上の位置づけ

```
[パラメトリック経路]  chat → Claude → BoxIR/HouseIR/... → build() → 送信   （v0〜v2）
[grid経路（v2.x）]     テストフィクスチャ/開発注入 → GridIR → build() → 送信  ★LLMを通さない★
[grid経路（v3予定）]   画像/3Dモデル → ボクセル化エンジン → GridIR → build() → 送信
```

- grid は `build()`（v2レジストリ）の新エントリ `buildGrid` として合流する。下流（ワールド変換・分割・送信・Undo）は全経路共通。
- 上流（誰が GridIR を作るか）だけが経路で異なる。v2.x はテスト注入、v3はボクセル化。**build()以降は不変**。

---

## 5. スコープ

### 5.1 v2.xでやること（In Scope）

- **dense voxel GridIR** の定義（3D配列 voxels ＋ palette index）。
- `buildGrid()`：voxels走査 → index→ブロックID展開 → **同一indexの連続を fill に畳む（run-merge）** → コマンド化。
- index 0（空気）の skip。
- size と voxels 次元の整合検証、palette index の素材検証＋フォールバック。
- grid を v2レジストリ・IRユニオンに追加。
- **テストフィクスチャ注入経路**（JSONを読み込んで GridIR として build に渡す開発/テスト用パス）。
- 共通基盤（facing変換・体積分割・全体AABB Undo）の grid 適用。

### 5.2 v2.xでやらないこと（Out of Scope：明示）

- **AI/LLM による grid 充填**。v2.xでは絶対にやらない（§9 R1）。
- **画像/3Dモデルのボクセル化エンジン**（＝充填手段の本命）。v3。
- AIプロンプトへの grid 追加（意図的に教えない）。
- 疎表現専用の最適化IR（密で統一）。
- grid 同士の合成・回転以外の変形・アニメーション。

### 5.3 将来拡張（設計余地を残す）

- `buildGrid` の run-merge は段階強化できる構造に（1D→2D→3D greedy、§6.3）。
- v3でボクセル化エンジンを **GridIR を吐く1ステージ**として grid経路の上流に差すだけで接続できるようにする。`buildGrid` 以降はノータッチ。

---

## 6. IR仕様（v2.x）

### 6.1 ユニオン拡張

```ts
type IR = BoxIR | HouseIR | PlatformIR | WallIR | TowerIR | GridIR;
```

既存型は一切変更しない。

### 6.2 GridIR スキーマ

```ts
interface GridIR {
  type: "grid";

  size: { w: number; h: number; d: number };  // ブロック寸法。各 1..64

  // dense voxel data。値は palette への index。0 = 空気（空き）で予約。
  // 次元順序は固定：voxels[y][z][x]
  //   y: 0..h-1（下→上のレイヤー）
  //   z: 0..d-1（各レイヤー内の行、lz=0 が正面）
  //   x: 0..w-1（行内の列）
  voxels: number[][][];

  // index → BEブロックID。0 は予約（air）なので含めない。
  palette: Record<number, string>;
}
```

### 6.3 検証・制約

- **次元整合**：`voxels.length === h`、各 `voxels[y].length === d`、各 `voxels[y][z].length === w`。不一致は**施工せず通知**（FR-42）。
- **次元順序の固定**：`voxels[y][z][x]`。⚠ ここを取り違えると形が転置/鏡像化する（§9 R2）。§付録Bの最小例で順序を必ず確認すること。
- **index 0 = air**：placeしない（skip）。世界は元々airである前提（開けた場所に建てる）。
- **palette検証**：voxels に現れる全非0 index が palette に存在すること。各ブロックIDを v0 §6.3 の素材検証にかける。**不明IDは skip せずフォールバック**（例 `minecraft:stone`）で埋める＝**穴を作らない**（§9 R5）。
- **サイズ上限**：各次元 1..64。総量（w·h·d）が過大な場合はクランプ or 拒否（密データ肥大の暴走防止、§9 R7）。v2.xはテストデータ前提なので小さく保つ。
- ローカル空間・facing・origin の扱いは他タイプと共通（正面 lz=0、既定 facing="auto"）。

---

## 7. コンポーネント詳細（v2.x差分）

### 7.1 C2: Claude APIクライアント（重要な"非"変更）

- **プロンプトに grid を追加しない。** AIは引き続き box/house/platform/wall/tower のみを出す。
- これは意図的な設計：AIに grid の存在を教えなければ、AIが voxels を埋めようとすることが**構造的に起きない**。grid充填をAIにさせない最も確実な担保。

### 7.2 grid注入経路（新規・開発/テスト用）

- テストフィクスチャ（`fixtures/*.json` 等）を読み込んで GridIR を構築し、`build(ir, origin)` に渡すパスを用意する。
- トリガーは開発用（例：チャットの特殊コマンド `!grid <name>` でフィクスチャ名を指定、もしくはCLI/テストランナーから直接）。**通常のLLM経路とは分離**する。
- これにより「器（buildGrid）の正しさ」を、充填手段と独立に検証できる。

### 7.3 C3: `buildGrid(ir, origin)` 展開仕様 ★中核★

`build()`（v2レジストリ）の `grid` エントリ。

#### 基本展開

- voxels を走査し、各非0セルを `palette[index]` のブロックにする。index 0 はskip。
- **per-voxel の setblock を量産してはいけない**（コマンド爆発・WSレート問題）。必ず**連続を fill に畳む**（下記 run-merge）。

#### run-merge（最低要件：X方向の1D run）

- 各 (y, z) 行について、x方向に**同一indexの極大ラン**を検出し、ラン1本を1つの `fill (x0,y,z)-(x1,y,z) <mat>` にする。
- これだけで per-voxel 比でコマンド数が大幅減（FR-41）。**v2.xの必須実装。**

#### run-merge（任意強化：2D/3D greedy）

- 必要なら X-run を z方向・y方向へ拡張し、同一indexの極大直方体に畳む（greedy maximal cuboid）。コマンド数がさらに減る。
- これは**最適化の差し替え**であり、`buildGrid` の外部挙動（結果ブロック）を変えない。コマンド数が多すぎる場合にのみ導入。

#### 共通後処理

- 各 fill 領域・各点を `toWorld(.., facing, origin)` でワールド化。⚠ 回転で min/max 角が入れ替わるので**変換後に再計算**（v1 §2.2）。
- **fill体積上限**を超える領域は分割（v0 FR-10流用）。merge後でも大領域は超え得る。
- 返り値 `BuildResult.region` は grid 全体（w×h×d）のワールドAABB。`commands` に送信コマンド列。

#### air上書き（任意）

- 既定：index 0 はskip（既存ブロックは消さない）。
- 同じ場所で建て直してテストする用途向けに、**「事前にAABBをairでクリアしてから置く」オプション**を設けてよい（実質Undo相当の前処理）。既定オフ。

### 7.4 C4: Undo

- 従来どおり `BuildResult.region`（grid全体AABB）を air 埋め戻し。変更なし。

---

## 8. 機能要件（v2.x・番号は v2 から継続）

> v0 FR-01〜12 / v1 FR-13〜26 / v2 FR-27〜37 は継続有効。以下を追加。

| ID | 要件 | 受け入れ観点 |
|---|---|---|
| FR-38 | `grid` 型をIRユニオン・v2レジストリに追加する（build署名不変） | grid が build 経由で建つ |
| FR-39 | `buildGrid` が voxels を走査し index→ブロックIDに展開する | 形がvoxelどおりに出る |
| FR-40 | index 0 を空気として skip する | 空きセルが空く |
| FR-41 | 同一indexの連続を fill に畳む（最低でもX方向run-merge） | コマンド数 ≪ voxel数 |
| FR-42 | size と voxels 次元の不一致を検出し、施工せず通知する | 不整合でクラッシュしない |
| FR-43 | palette の各非0 index を素材検証し、不明はフォールバックで埋める | 不明素材でも穴にならない |
| FR-44 | grid も facing変換・体積分割・全体AABB Undo を共通基盤で満たす | 各機能が grid でも効く |
| FR-45 | grid データはフィクスチャ/開発注入から供給し、LLM経路を通さない | AIが grid を出さない |
| FR-46 | dims/総量を上限クランプ or 拒否する | 過大データで暴走しない |

---

## 9. 非機能要件（v2.x差分）

- v0〜v2の非機能要件は継続。
- ロギングに **grid寸法・非0voxel数・生成fill数（merge効果）・フォールバック発生**を追加。merge前後のコマンド数比を出すとデバッグに有用。
- `buildGrid` の run-merge は**単体テスト必須**（既知フィクスチャ→期待fill列）。次元順序バグ（R2）の早期検出に直結。

---

## 10. 完了条件（Acceptance Criteria・v2.x）

| ID | 条件 |
|---|---|
| AC-22 | 手書きの小さなgridフィクスチャ（例：階段・対称オブジェクト）が、形どおり正確に建つ |
| AC-23 | 同色連続が fill に畳まれ、コマンド数が非0voxel数より大幅に少ない |
| AC-24 | 空気セルが空き、不明素材はフォールバックで埋まり穴にならない |
| AC-25 | size/voxels 不一致でクラッシュせず通知する |
| AC-26 | grid も facing で正しく向き、Undoで全体が消える |
| AC-27 | AIプロンプトに grid が無く、AIが voxel を生成しない。`build(ir,origin)` 署名は不変 |
| AC-28 | 次元順序 voxels[y][z][x] が付録Bの最小例と一致する（転置/鏡像でない） |

---

## 11. 既知のリスク・要確認事項（v2.x）

| # | 項目 | 内容・対処 |
|---|---|---|
| R1 | **AIに grid を埋めさせない** | v2.xの生命線。プロンプトに grid を出さず、充填はフィクスチャ/開発経路のみ。AIフリーハンドのvoxelは品質崩壊する。「誰が埋めるか」は v3 の問題として切り離す。 |
| R2 | 次元順序の取り違え | `voxels[y][z][x]` を固定。間違えると形が転置/鏡像化。付録Bの最小例＋単体テストで担保。 |
| R3 | コマンド爆発 | per-voxel setblock 厳禁。最低でもX-run merge（FR-41）。足りなければ3D greedy。 |
| R4 | air の扱い | 既定skip。上書き用の事前airクリアはオプション（既定オフ）。 |
| R5 | 不明素材で穴 | skipせずフォールバックで埋める（FR-43）。穴は形を壊す。 |
| R6 | fill体積上限 | merge後の大fillでも超え得る。分割（v0 FR-10）流用。 |
| R7 | サイズ肥大 | 密データは肥大しやすい。各次元≤64、総量上限でクランプ/拒否。v2.xはテストデータで小さく保つ。 |

---

## 付録A：buildGrid 擬似コード（X-run merge 版）

```ts
function buildGrid(ir: GridIR, origin: Vec3): BuildResult {
  validateDims(ir);                         // size と voxels の整合（FR-42）
  const pal = resolveGridPalette(ir);       // 各非0 indexを素材検証＋フォールバック
  const facing = resolveFacing(ir);
  const { w, h, d } = clampSize(ir.size);

  const ops: LocalOp[] = [];
  for (let y = 0; y < h; y++) {
    for (let z = 0; z < d; z++) {
      const row = ir.voxels[y][z];          // 長さ w
      let x = 0;
      while (x < w) {
        const idx = row[x];
        if (idx === 0) { x++; continue; }   // air skip
        let x1 = x;
        while (x1 + 1 < w && row[x1 + 1] === idx) x1++;  // 同一indexの極大ラン
        ops.push(fillOp(x, y, z, x1, y, z, pal[idx]));   // 1本のfillに畳む
        x = x1 + 1;
      }
    }
  }

  const commands = ops.map(op => toWorldCommand(op, facing, origin)); // 体積上限で分割
  const region = worldAABB(localBox(w, h, d), facing, origin);
  return { region, commands };
}
```

2D/3D greedy へ強化する場合も、この関数の**入出力契約（GridIR→BuildResult）は不変**。merge戦略のみ差し替える。

---

## 付録B：次元順序の最小確認例（★必読★）

`size:{w:3,h:2,d:1}` の小さな grid。`voxels[y][z][x]` の順序を固定する基準例：

```json
{
  "type": "grid",
  "size": { "w": 3, "h": 2, "d": 1 },
  "voxels": [
    [ [1, 1, 1] ],
    [ [1, 0, 0] ]
  ],
  "palette": { "1": "minecraft:stone" }
}
```

- 外側＝y（2要素：下層・上層）、中＝z（1要素）、内＝x（3要素）。
- y=0（下層）：x=0..2 すべて stone。
- y=1（上層）：x=0 だけ stone、x=1,2 は air。
- 期待される形：**底に幅3の段＋左端に1ブロック積んだL字**。
- これが「上層が右端に乗る」「奥行きに伸びる」等になったら**次元順序がバグっている**（R2）。AC-28・単体テストで必ず確認。

---

## 付録C：v2.x完了後の次の一歩（v3予告）

grid（器）が堅牢に展開できれば、次は**充填手段**を上流に足すだけ：

- **道A（決定論・本命）**：3Dモデル（.obj/.glb）→ ボクセル化エンジン → GridIR。立体キャラの正解ルート。AIは素材マッピング（index→ブロック）だけ担当。
- **道B（推定・茨）**：1枚絵 → 単視点3D復元 → GridIR。奥行きの欠落を埋める推定が要り精度が出にくい。

いずれも **GridIR を吐く1ステージを grid経路の上流に差すだけ**で、`buildGrid` 以降は不変。v2.x で器を密版で正しく定義した投資がここで効く。AIの仕事は「想像で形を作る」ではなく「リファレンスをどの素材に割り当てるか」に縮退する。