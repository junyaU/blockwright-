# 要件定義書：Minecraft統合版 AI建築システム v1

> 対象実装者：Claude Code
> 版：v1（house型の追加）／前提：v0 実装済み
> 言語/環境：Node.js on WSL2、Minecraft Bedrock（Windows）
> 関連：`requirements_minecraft_ai_builder_v0.md`（本書はその差分・拡張）

---

## 0. このドキュメントの読み方（Claude Codeへの前提指示）

- 本書は **v0への差分**である。v0の方針・制約はすべて継続して有効。特に以下の不変条件を**絶対に壊さない**：
  - **`build(ir, origin)` の署名は不変**。v1での追加は `build()` 内の `type` 分岐（`buildHouse`）追加と IR への `house` 型追加のみ。呼び出し側・原点解決・送信・Undoの土台は変えない。
  - **IRは絶対座標を持たない**。「どこに建てるか」は引き続き `origin` で外から与える。
  - **AIは座標・コマンドを一切出さない**。v1の核心はここ（§2.1）。
- v1の設計思想は **「AI=設計、コード=施工」の徹底**。AIは*パラメータ*だけを埋め、**幾何（座標計算・形状生成）は100%コード側が決定論的に**行う。LLMに層ごとのvoxelを並べさせる汎用グリッド方式は v1 では**採用しない**（§11 R1）。
- スコープを勝手に広げない。§4.2「やらないこと」を厳守。

---

## 1. 背景と目的

v0で「喋ったら箱が建つ」ループは通った。v1のゴールは **箱が"ちゃんと家に見える"** ところまで表現力を上げること。具体的には、AIが寸法・屋根・素材などの**パラメータ**を出し、コードがそれを壁・床・ドア開口・窓・屋根を持つ建物として確定的に組み上げる。

このバージョンで「v0→v1の体感ジャンプ」（ただの箱→建築物）が出る。同時に、palette を意味スロット化することで**素材スタイル軸も同時に獲得**する（§5.3）。

---

## 2. アーキテクチャ上の位置づけ

### 2.1 不変条件（v1の生命線）

```
発言 ──▶ Claude API ──▶ IR(パラメータのみ) ──▶ build()/buildHouse() ──▶ コマンド ──▶ 送信
                         ★座標を含まない★        ★ここで初めて座標が生まれる★
```

- AIの責務は **パラメータの充填のみ**（footprint, height, roof, door位置, 窓パターン, 素材）。
- 幾何の責務は **buildHouse() のみ**。壁の位置、屋根の傾斜、開口の座標は全部コードが算出する。
- この分離により「LLMは3D座標が苦手」という弱点を**構造的に回避**する。v0で箱が安定していたのと同じ理由を、house型でも維持する。

### 2.2 ローカル空間 → ワールド空間 変換（v1で新規導入）

幾何生成を向き（facing）から独立させるため、**ローカル建物空間**で全形状を組み、最後にワールド座標へ写像する。

- ローカル空間：`lx ∈ [0, w-1]`, `lz ∈ [0, d-1]`, `ly ∈ [0, 屋根頂部]`。**正面壁 = `lz = 0` の壁**（ローカル前方）と定義する。
- `toWorld(localVec, facing, origin)`：facing（4方位）に応じてローカル座標をY軸回りに90°単位で回転し、`origin` で平行移動してワールド座標を返す。
- ⚠ `fill` は領域（箱）を渡すが、90°回転で min/max 角が入れ替わる。**変換後に必ず min/max を再計算**してから `fill` 文字列を組むこと。点単位（ドア・窓）は各点を個別に変換。
- **段階導入可**：変換実装が重ければ、v1.0は `facing` を1方位固定で出し、yaw由来の自動facingを v1.1 に回してよい（§5.2 `facing:"auto"` 参照）。ただしローカル空間で組む設計自体は v1.0 から入れる。

---

## 3. 実行環境

v0から変更なし（WSL2 + Node.js、Windows側Minecraft、`0.0.0.0`バインド、ループバック例外、座標は絶対指定）。本書では再掲しない。v0要件の§3をそのまま適用する。

---

## 4. スコープ

### 4.1 v1でやること（In Scope）

- IRに **`house` 型**を追加（`box` は維持＝後方互換）。
- `house` のパラメータ：footprint(w×d)・height・roof(flat/gable)・door・windows・palette/style・facing。
- `buildHouse()` を新規実装し、**決定論的に**以下を生成：床／四方の壁／（任意）トリム（隅柱）／ドア開口／窓／屋根（flat・gable）／gableの妻壁三角埋め。
- **palette の意味スロット化**（wall/floor/roof/trim/window）＝素材を面ごとに塗り分け。
- **named style** からpaletteへの展開（小さなプリセット辞書）。
- ローカル空間→ワールド空間変換（§2.2）。
- Undo領域を**屋根・オーバーハングを含む全体AABB**に拡張。
- AIプロンプトを box/house の選択＋house パラメータ充填に対応させる。

### 4.2 v1でやらないこと（Out of Scope：明示）

- 汎用グリッドIR（`grid`型）＝自由形状。**v2.x のエスケープハッチで導入予定**、v1ではやらない。
- 建物タイプの複数化（塔・橋・壁など）＝v2。v1は `house` のみ。
- 画像/設計図入力＝v3。
- 実際に機能するドアブロック/トラップドア/階段ブロックの設置（向き・half等のblock state管理）。**v1はドアは1×2の開口（air）のみ**。実ドア設置は v1.x。
- 屋根スタイルの hip/shed/mansard 等。v1は flat と gable のみ。
- 内装（家具・床材の張り分け以上）・複数部屋・階層。
- ブロック単位の完全Undo（領域air埋め戻しのまま）。

### 4.3 将来拡張（設計余地は残す）

- `roof` を string enum にしておき、後で `"hip"` 等を追加可能に。
- palette をスロット辞書にしておくことで、スタイル語彙は presets を足すだけで増える。
- `buildHouse` 内を「床/壁/開口/屋根」の小関数に分割しておくと、v2の他タイプ生成器が部品を再利用できる。

---

## 5. IR仕様（v1）★最重要★

### 5.1 ユニオン拡張

```ts
type IR = BoxIR | HouseIR;   // v0の BoxIR は不変。HouseIR を追加。
```

`box`（v0定義）は一切変更しない。後方互換を必ず維持する。

### 5.2 HouseIR スキーマ

```ts
interface HouseIR {
  type: "house";                       // discriminator

  footprint: { w: number; d: number }; // 外形（ブロック数）。各 5..32 を許容
  height: number;                       // 壁の高さ（床上〜軒下）。3..12

  roof: "flat" | "gable";
  roofOverhang?: number;                // 軒の張り出し。0..2、既定 1

  door?: {
    position?: "center" | number;       // 正面壁(lz=0)に沿った開口の横位置。既定 "center"
  };

  windows?: {
    pattern?: "none" | "even";          // 既定 "even"
    count?: number;                      // even時、長辺あたりの窓数。既定は壁長から自動
    sill?: number;                       // 窓の下端の高さ（床からのブロック数）。既定 1
  };

  // 素材：palette を直接指定 or style名で指定。両方あれば palette を優先。
  palette?: Palette;
  style?: string;                        // 例 "rustic" | "stone" | "modern"

  facing?: "north" | "south" | "east" | "west" | "auto"; // 既定 "auto"（プレイヤーyaw由来）
}

interface Palette {
  wall:   string;   // 必須
  floor:  string;   // 必須
  roof:   string;   // 必須
  trim?:  string;   // 任意。既定 = wall
  window?: string;  // 任意。既定 "minecraft:glass"
}
```

### 5.3 palette / style 解決ルール

- 最終的に **wall/floor/roof が必ず埋まった Palette** を得る。手順：
  1. `palette` があればそれを基底にする。
  2. なければ `style` を presets 辞書で展開して基底にする。
  3. どちらも無ければ既定 style（例 `"rustic"`）を使う。
  4. `palette` と `style` 両方ある場合は **palette を優先**（明示が勝つ）。`palette` で欠けたスロットは style で補完してよい。
  5. `trim` 未指定なら `wall` を、`window` 未指定なら `minecraft:glass` を充てる。
- **全スロットを個別に素材検証**（v0 §6.3の検証を流用）。不明IDはスロットごとにフォールバックし、ログ警告。検証前のpaletteで施工しない。
- presets 辞書はコード側に小さく持つ（v1は3種程度で十分）。各presetの値は**実在するBEブロックID**であること。

### 5.4 制約・バリデーション

- `footprint.w/d`：整数 5..32。窓・ドアが収まる最小寸法（5）を下回らない。範囲外はクランプ。
- `height`：整数 3..12（ドア2＋まぐさ1で最低3）。
- `roofOverhang`：0..2。
- `door.position`：数値の場合 `1..w-2` にクランプ（角を避ける）。"center" は `floor((w-1)/2)`。
- `windows.count`：壁に収まる上限にクランプ。0なら "none" 相当。
- `facing`：enum。"auto" はプレイヤーyawから4方位にスナップ（§6.2）。
- パラメータ不正やスキーマ不一致は **施工せずゲーム内チャットで失敗通知**（無言失敗禁止）。

---

## 6. コンポーネント詳細仕様（v1差分）

### 6.1 C2: Claude APIクライアント（プロンプト更新）

- システムプロンプトに **box と house の両スキーマ**を提示し、出力は §5 のユニオンに厳密準拠したJSONのみ（フェンス・前置き禁止）とする。
- 選択指針を明示：「家・小屋・住居のような居住物 → `house`」「単純な塊・台・壁 → `box`」。
- house選択時：可能なら `style` 名 か `palette` を埋める。迷う場合は `style` を選ばせる（コード側が確実に展開するため）。
- 寸法は§5.4の範囲内で出すよう促す（最終防衛はコード側クランプ）。
- 出力パース・検証・1回リトライ・失敗通知は v0 と同じ枠組み。

### 6.2 原点・facing解決

- `origin`：v0同様、プレイヤーの**絶対座標**を基準に与える（相対 `~` は使わない）。house は origin をローカル空間の基準点（既定：正面壁の手前・足元の角、もしくは footprint の基準角）として扱う。具体の対応付けはコードで固定定義する。
- `facing:"auto"`：建築時にプレイヤーの **yaw を取得**し、最も近い4方位へスナップする。**正面壁（lz=0）がプレイヤー側を向く**＝ドアがプレイヤーから見える向きにする。yaw取得手段は v0 の座標問い合わせと同じ経路で確定（要疎通確認）。

### 6.3 C3: `buildHouse(ir, origin)` 施工仕様 ★中核★

`build(ir, origin)` の `case "house"` から呼ぶ。**全てローカル空間で組み、最後に `toWorld` でワールド化**してコマンド生成する。

#### 施工順序（この順を守る：後工程が前工程を上書きして開口を作る）

1. **palette解決＆検証**（§5.3）。`facing` 解決（§6.2）。
2. **床**：`lx∈[0,w-1], lz∈[0,d-1], ly=0` を `palette.floor` で fill。
3. **四方の壁**：`ly∈[1,h]` で4面を `palette.wall` で fill。
   - 北(lz=0) / 南(lz=d-1) / 西(lx=0) / 東(lx=w-1)。角は重複可（上書きで問題なし）。
   - 内部はairのまま（天井は作らない＝屋根がふさぐ）。
4. **トリム（任意）**：`palette.trim` で4隅の柱（`ly∈[1,h]` の4本の垂直エッジ）を上書き。trim未指定時は wall と同色なので見た目変化なし＝スキップ可。
5. **ドア開口**：正面壁(lz=0)の `door.position` 位置に **幅1×高さ2** の air を置いて開口する（`ly=1,2`）。**実ドアブロックは置かない**（§4.2）。
6. **窓**：`pattern:"even"` のとき、正面以外（または全壁）に等間隔で `palette.window` を配置。
   - 高さは `ly = 1 + sill`（既定 sill=1 → ly=2 あたり）。サイズは v1 では 1×1。
   - 個数は `count` か、壁長から自動算出（端から1ブロック以上空ける／ドアと衝突しない位置にクランプ）。
   - 配置は壁ブロックを window 素材で**上書き**する形。
7. **屋根**：`roof` に応じて生成（下記）。**屋根は壁の上 `ly=h+1` から始める**。
8. **gableの妻壁埋め**（gable時のみ）：屋根の三角形の下にできる壁の隙間を `palette.wall` で埋める（下記）。

#### 屋根：flat

- `ly = h+1` に footprint（オーバーハング分だけ各辺へ拡張可）を `palette.roof` で1層 fill。

#### 屋根：gable（精密仕様）

- **棟（ridge）方向 = 長辺方向**。`w ≥ d` なら棟はX方向、そうでなければZ方向（以下はX棟・Z方向に勾配する場合で記述。逆は対称に実装）。
- 勾配はZ方向に1段ごとに1ブロック上がり1ブロック内側へ寄る**階段状**。
- 断面イメージ（Z–Y平面、`R`=roof, `W`=wall）：

```
        R              ← ridge（中央）
      R   R
    R       R
  R           R
W W W W W W W W W       ← 軒（ly=h+1）, lz=0 .. d-1
W               W
W               W      ← 壁（ly=1..h）
```

- 生成（オーバーハングは一旦0として記述、`roofOverhang>0`なら各段のX範囲を `-ov..w-1+ov` に拡張）：
  ```
  half = floor((d - 1) / 2)
  for k in 0..half:
      y    = h + 1 + k
      zLo  = k
      zHi  = d - 1 - k
      # 両スロープ（X全長 0..w-1）
      fill (0, y, zLo) .. (w-1, y, zLo)  palette.roof
      if zHi != zLo:
          fill (0, y, zHi) .. (w-1, y, zHi)  palette.roof
  # d が偶数なら頂部が幅2のフラット棟、奇数なら幅1の棟になる（どちらも可）
  ```
- **妻壁（gable end）埋め**：棟に直交する2つの端壁（X棟なら lx=0 と lx=w-1）の、屋根の下にできる三角形の隙間を `palette.wall` で塞ぐ。各段 `k`（k≥1）で `y=h+1+k`、`lz∈[zLo+1, zHi-1]` を wall で埋める（屋根のエッジは屋根工程で上書き済み or 後で上書き）。これを忘れると妻側に穴が開く。

#### 共通

- 各 fill 領域・各点を `toWorld(.., facing, origin)` でワールド化し、§2.2の min/max 再計算を適用。
- **`fill` 体積上限**（v0 §6.3／FR-10、上限はおよそ32768ブロック・要確認）を超える領域は分割。屋根スラブや大きな壁で超え得る。
- 返り値 `BuildResult.region` は **屋根頂部・オーバーハングまで含む全体のワールドAABB**にする（Undo用）。`commands` に送信コマンド列を格納。

### 6.4 C4: Undoマネージャ（差分）

- house の `BuildResult.region`（屋根含む全体AABB）を air で埋め戻すだけ。ロジックはv0のまま。領域がv0より大きくなる点のみ留意（fill分割が効くこと）。

---

## 7. 機能要件（v1・番号はv0から継続）

> v0の FR-01〜FR-12 は引き続き有効。以下を追加。

| ID | 要件 | 受け入れ観点 |
|---|---|---|
| FR-13 | IRに `house` 型を追加し、`box` も従来どおり動作する | box/house 両方が建つ（後方互換） |
| FR-14 | AIが居住物の指示で `house` 型のパラメータJSONを返す | 妥当な house IR が得られる |
| FR-15 | palette/style を解決し、wall/floor/roof が必ず埋まる | 素材が面ごとに反映される |
| FR-16 | 各paletteスロットを個別に素材検証し、不明はフォールバック | 不正素材でも落ちず代替で建つ |
| FR-17 | `buildHouse` が床・四方の壁を決定論生成する | 閉じた箱状の躯体が建つ |
| FR-18 | 正面壁に幅1×高さ2のドア開口を空ける | 出入りできる開口がある |
| FR-19 | `windows:"even"` で等間隔の窓（glass）を配置する | 窓が規則的に並ぶ・ドアと衝突しない |
| FR-20 | `roof:"flat"` で屋根スラブを生成する | 平屋根がふさがる |
| FR-21 | `roof:"gable"` で階段状の切妻屋根を生成する | 三角屋根になり頂部で閉じる |
| FR-22 | gable時、妻壁の三角隙間を壁素材で塞ぐ | 妻側に穴が開かない |
| FR-23 | ローカル空間で生成し、facingに応じてワールド変換する | 回転しても形状が崩れない／min-max正しい |
| FR-24 | `facing:"auto"` でドアがプレイヤー側を向く | 正面がプレイヤーに向く |
| FR-25 | 寸法・位置パラメータを§5.4の範囲にクランプする | 極端値でもクラッシュしない |
| FR-26 | Undo領域が屋根・オーバーハングを含む全体を覆う | Undoで家が完全に消える |

---

## 8. 非機能要件（v1差分）

- v0の非機能要件（ロギング・耐障害・設定外出し・秘匿情報）は継続。
- ロギングに **解決後palette・facing・生成した各工程の領域**を追加（屋根や妻壁の不具合追跡用）。
- `buildHouse` は床/壁/開口/窓/屋根/妻壁の**小関数に分割**して実装する（テスト容易性とv2再利用のため）。

---

## 9. 完了条件（Acceptance Criteria・v1）

| ID | 条件 |
|---|---|
| AC-08 | 「家を建てて」で、床・四方の壁・ドア開口・窓・屋根を持つ建物がプレイヤー付近に出現する |
| AC-09 | `roof:"gable"` で三角屋根になり、頂部で閉じ、妻壁に穴が無い |
| AC-10 | style もしくは palette により、壁・床・屋根が異なる素材で塗り分けられる |
| AC-11 | ドアがプレイヤー側（正面）を向いており、1×2で通り抜けられる |
| AC-12 | v0の box 指示が従来どおり動く（リグレッション無し） |
| AC-13 | Undoで屋根を含む家全体が air に戻る |
| AC-14 | 極端な寸法・不正素材・架空ブロックでもクラッシュせず、クランプ／フォールバックして建つ |
| AC-15 | `build(ir, origin)` の署名がv0から不変で、house IR が絶対座標を含まない |

---

## 10. 技術スタック

v0から変更なし。TypeScript推奨（ユニオン型 `BoxIR | HouseIR` と網羅チェックの恩恵が大きい）。`buildHouse` 周りはファイル分割（例：`build.ts` から `house/floor.ts`, `house/walls.ts`, `house/roof.ts` 等）を許容。

---

## 11. 既知のリスク・要確認事項（v1）

| # | 項目 | 内容・対処 |
|---|---|---|
| R1 | AIに幾何を漏らさない | v1の生命線。AIはパラメータのみ。**層voxelや座標を出させる実装にしないこと**。汎用gridはv2.xまで封印。 |
| R2 | 回転変換の min/max | 90°回転で fill の角が入れ替わる。変換後に必ず min/max 再計算（§2.2）。ここのバグが「家が崩れる/欠ける」の主因になる。 |
| R3 | gableのパリティ | d が偶数/奇数で頂部が幅2/幅1になる。両方とも破綻しないことを確認。 |
| R4 | 妻壁の穴 | gableで妻壁三角埋め（FR-22）を忘れると端に穴。施工順序（屋根→妻壁 or 妻壁→屋根）を固定してテスト。 |
| R5 | 開口の衝突 | ドア・窓が角や屋根、互いと衝突しないよう位置クランプ。door は `1..w-2`。 |
| R6 | facing自動の正しさ | yaw→4方位スナップの境界（45°境界）でブレうる。実機で確認。重ければv1.0は固定facingで出す。 |
| R7 | fill体積上限 | 屋根スラブ・大壁で上限超過しうる。分割（v0 FR-10）を流用。 |
| R8 | style素材IDの実在性 | presets の各ブロックIDがBEに実在すること。検証フィルタを通す。 |

---

## 付録A：buildHouse 擬似コード（骨子）

```ts
function buildHouse(ir: HouseIR, origin: Vec3): BuildResult {
  const pal = resolvePalette(ir);              // §5.3 + 素材検証
  const facing = resolveFacing(ir);            // §6.2（auto→yaw）
  const { w, d } = clampFootprint(ir.footprint);
  const h = clampHeight(ir.height);

  const ops: LocalOp[] = [];                   // ローカル空間の fill/setblock 指示を貯める
  floor(ops, w, d, pal.floor);                 // ly=0
  walls(ops, w, d, h, pal.wall);               // ly=1..h, 4面
  if (ir.trim) corners(ops, w, d, h, pal.trim);
  carveDoor(ops, w, doorX(ir, w));             // 正面 lz=0, 1x2 air
  if (windows(ir) !== "none") placeWindows(ops, w, d, h, ir, pal.window);
  if (ir.roof === "flat") flatRoof(ops, w, d, h, ir.roofOverhang, pal.roof);
  else gableRoof(ops, w, d, h, ir.roofOverhang, pal.roof, pal.wall); // 妻壁埋め含む

  // ローカル→ワールド変換（fill領域は min/max 再計算）
  const commands = ops.map(op => toWorldCommand(op, facing, origin));
  const region = worldAABB(ops, facing, origin); // 屋根・オーバーハング込み
  return { region, commands };
}
```

各小関数（floor/walls/carveDoor/placeWindows/flatRoof/gableRoof）は§6.3の仕様どおりに、**ローカル座標で**領域・点を積むだけ。座標のワールド化は最後に一括で行う＝幾何ロジックを facing から独立させる。

---

## 付録B：v1完了後の次の一歩（参考・v2予告）

- `build()` の switch に `case "tower"` 等を追加し、各タイプを**パラメトリック生成器**としてライブラリ化。AIは「どのタイプを選び、パラメータをどう埋めるか」だけ（retrieval/composition）。これはv1で作った floor/walls/roof 等の部品を再利用できる。
- 自由形状が要るケースのみ `case "grid"` を**エスケープハッチ**として限定導入（普段使いはパラメトリック、変形時だけグリッド）。
- いずれも `build(ir, origin)` の署名は不変のまま。v0で引いた seam の投資が継続して効く。