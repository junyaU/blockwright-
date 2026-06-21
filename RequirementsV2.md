# 要件定義書：Minecraft統合版 AI建築システム v2

> 対象実装者：Claude Code
> 版：v2（tower / wall / bridge 型の追加）／前提：v0（box）・v1（house）実装済み
> 言語/環境：Node.js on WSL2、Minecraft Bedrock（Windows）
> 関連：`RequirementsV0.md`（box）・`RequirementsV1.md`（house）。本書はその差分・拡張。

---

## 0. このドキュメントの読み方（Claude Codeへの前提指示）

- 本書は **v0/v1への差分**である。v0/v1の方針・制約はすべて継続して有効。特に以下の不変条件を**絶対に壊さない**：
  - **`build(ir, origin)` の署名は不変**。v2での追加は `build()` 内の `type` 分岐（`buildTower`）追加と IR への `tower` 型追加のみ。呼び出し側・原点解決・送信・Undoの土台は変えない。
  - **IRは絶対座標を持たない**。「どこに建てるか」は引き続き `origin` で外から与える。
  - **AIは座標・コマンド・voxelを一切出さない**。AIが埋めるのはパラメータのみ。幾何は100%コード側が決定論的に算出する。
  - **単一の失敗でプロセスを落とさない**。失敗はゲーム内チャットで通知。
  - **素材は「信頼してから施工時フォールバック」**（statusCode≠0でフォールバック素材へ）。
- v2の設計思想は v1 を継承し、**「AI=タイプ選択＋パラメータ充填、コード=パラメトリック生成」**。LLMに層voxelや座標を出させる汎用グリッド方式は v2 でも**採用しない**（grid エスケープハッチは将来送り）。
- スコープを勝手に広げない。§4.2「やらないこと」を厳守。v2 の新タイプは **tower / wall / bridge の 3 種**（いずれもパラメトリック生成器。box/house と同じ seam で追加）。

---

## 1. 背景と目的

v1で「ただの箱 → 家に見える建物」のジャンプは通った。v2のゴールは v1 付録B が予告した **「パラメトリック建物タイプのライブラリ化」**を踏むこと。具体的には新タイプ `tower`（角形塔）・`wall`（防壁）・`bridge`（橋）を追加し、AIが「どのタイプを選びパラメータをどう埋めるか」だけを担い、コードが各タイプの形状（床/壁/開口/上部処理/欄干/橋脚 等）を決定論的に組み上げる。

このバージョンで「単独の建物 → 構造物の語彙が増える」体感ジャンプが出る。同時に、house で作った躯体プリミティブ（床/壁/隅柱/等間隔配置/ドア開口）と座標変換 seam が**各タイプで再利用できる**ことを実証する＝v1で引いた seam の投資が継続して効くことの確認。`build()` の switch に case を足すだけで（呼び出し側・原点解決・Undo・送信はノータッチ）タイプが増える設計の検証でもある。

---

## 2. アーキテクチャ上の位置づけ

### 2.1 不変条件（v2の生命線・再掲）

```
発言 ──▶ Claude API ──▶ IR(タイプ＋パラメータのみ) ──▶ build()/buildTower() ──▶ コマンド ──▶ 送信
                         ★座標を含まない★               ★ここで初めて座標が生まれる★
```

- AIの責務は **タイプ選択とパラメータ充填のみ**（footprint, height, cap, windows, 素材, facing）。
- 幾何の責務は **buildTower() のみ**。壁の位置、cap の座標、開口の座標は全部コードが算出する。

### 2.2 v2の seam 拡張点（触る箇所は3点だけ）

1. **`build.ts`** の switch に `case "tower": return buildTower(ir, origin);` を1行追加。
2. **`geometry.ts`** の `transformHouse` を type 非依存名 `transformBuilding` に**改名**（実装は完全に汎用なので名前のみ。house/tower が共用）。
3. **`palette.ts`** の `resolvePalette` 引数を `HouseIR` → 構造的型 `PaletteSource { palette?; style? }` に**緩める**（本体ロジック無変更。house/tower 双方が満たす）。

house.ts の `floor`/`walls`/`corners`/`carveDoor`/`doorXOf`/`evenPositions`/`fillOp` は型非依存なので **export 化して `tower.ts` から共用**（複製しない）。tower 固有なのは「縦スリット窓」と「上部処理（flat cap / battlement 胸壁）」のみ。

---

## 3. 実行環境

v0/v1から変更なし（WSL2 + Node.js、Windows側Minecraft、`0.0.0.0`バインド、ループバック例外、絶対座標）。本書では再掲しない。

---

## 4. スコープ

### 4.1 v2でやること（In Scope）

- IRに **`tower` / `wall` / `bridge` 型**を追加（`box`/`house` は維持＝後方互換）。
- `tower`：footprint(w×d)・height・cap(flat/battlement)・shape(square)・door・windows(slit)・palette/style・facing。生成＝床／四方壁／隅柱(trim)／ドア開口／縦スリット窓／上部処理（flat cap・battlement 胸壁）。
- `wall`：length・height・thickness・crenellation・gate・palette/style・facing。生成＝壁本体スラブ／通用門開口(air)／上部胸壁。
- `bridge`：span・width・railing・piers・palette/style・facing。生成＝桁(deck)／両側欄干／（任意）橋脚(ly<0 へ降下)。
- house の躯体プリミティブの **export 共有**（floor/walls/corners/carveDoor/doorXOf/evenPositions/fillOp）。
- `resolvePalette` の **構造的型化**（PaletteSource）。各タイプが style 未指定時に "stone" を既定にフォールバック。
- `transformHouse` → `transformBuilding` への **改名**（全タイプ共用）。
- AIプロンプトを box/house/tower/wall/bridge の選択＋各パラメータ充填に対応。bridge 用トリガー語「架けて/かけて」を追加。

### 4.2 v2でやらないこと（Out of Scope：明示）

- **`shape:"round"`（円形断面）** ＝ enum は受けるが square に縮退（警告）。実装は将来。
- **`taper`（先細り）** ＝ optional は受けるが無視（警告）。実装は将来。
- 内部の階段・複数階の床・梯子（塔の中身は air のまま）。
- wall の一定間隔の塔・実ゲート扉、bridge のアーチ橋・地形追従の橋脚長（橋脚は固定深さ）＝将来。
- 汎用グリッドIR（`grid`型）＝自由形状エスケープハッチ。v2でもやらない。
- 実ドア/階段ブロックの設置（block state 管理）。開口は air のまま。
- ブロック単位の完全Undo（領域air埋め戻しのまま）。

### 4.3 将来拡張（設計余地は残す）

- `shape` を enum に、`taper` を optional に切ってあるので、後で実装を足すだけで有効化できる（seam 確保済み）。
- `cap` を string enum にしておき、後で `"cone"`（円錐屋根）等を追加可能に。
- `buildTower` 内を小関数に分割してあるので、将来の他タイプ生成器が部品を再利用できる。

---

## 5. IR仕様（v2）★最重要★

### 5.1 ユニオン拡張

```ts
type IR = BoxIR | HouseIR | TowerIR | WallIR | BridgeIR;   // box/house は不変。3 型を追加。
```

`box`/`house` は一切変更しない。後方互換を必ず維持する。

### 5.2 TowerIR スキーマ

```ts
type TowerCap = "flat" | "battlement";
type TowerShape = "square" | "round";   // round は将来（square に縮退）

interface TowerIR {
  type: "tower";
  footprint: { w: number; d: number };  // 外形。各 3..16
  height: number;                        // 塔身（床上〜cap手前）。5..48
  cap?: TowerCap;                        // 既定 "battlement"
  shape?: TowerShape;                    // 既定 "square"
  taper?: number;                        // 将来。v2 は無視（非0は警告）
  door?: { position?: "center" | number };
  windows?: {
    pattern?: "none" | "slit";           // 既定 "slit"（狭間）
    count?: number;                       // 各面のスリット本数。省略時自動
    sill?: number;                        // スリット下端の高さ。既定 2
    span?: number;                        // スリットの縦の高さ。既定 3
  };
  palette?: Palette;                      // v1 と同じ意味スロット
  style?: string;
  facing?: "north" | "south" | "east" | "west" | "auto";  // 既定 "auto"
}
```

`Palette`（wall/floor/roof/trim/window）は v1 のまま再利用。tower では `roof` スロットが cap（天井/胸壁）素材、`window` がスリット素材、`trim` が隅柱と merlon 素材として機能する。

### 5.2b WallIR スキーマ

```ts
interface WallIR {
  type: "wall";
  length: number;   // 長さ。5..64
  height: number;   // 高さ。3..16
  thickness?: number;       // 厚み。1..4、既定 1
  crenellation?: boolean;   // 上部胸壁。既定 true
  gate?: { position?: "center" | number; width?: number; height?: number }; // 通用門開口
  palette?: Palette; style?: string; facing?: Facing | "auto";
}
```

wall では `wall` スロットが本体、`trim`（既定 wall）が胸壁 merlon。

### 5.2c BridgeIR スキーマ

```ts
interface BridgeIR {
  type: "bridge";
  span: number;     // 長さ。5..64
  width: number;    // 幅。2..16
  railing?: boolean; // 両側欄干。既定 true
  piers?: boolean;   // 橋脚（下方向の支柱、固定深さ 4）。既定 true
  palette?: Palette; style?: string; facing?: Facing | "auto";
}
```

bridge では `floor` が桁(deck)、`wall` が欄干、`trim`（既定 wall）が橋脚。橋脚は `ly<0`（origin.y=プレイヤー足元より下）へ降ろす。

### 5.3 palette / style 解決の汎用化

- `resolvePalette(src: PaletteSource)` に引数型を緩め、house/tower が共用する。ロジックは v1 §5.3 と同一（palette 優先→style→既定、各スロット素材検証）。
- **tower は石造が自然なので、`buildTower` 側で style 未指定時に `"stone"` を既定**にフォールバックする（`resolvePalette({ palette: ir.palette, style: ir.style ?? "stone" })`）。palette 直指定があればそちらが優先される。
- presets 辞書（rustic/stone/modern）は v1 のまま流用。tower 専用 preset は追加しない（stone で十分）。

### 5.4 制約・バリデーション

- `footprint.w/d`：整数 3..16。範囲外はクランプ。
- `height`：整数 5..48。
- `cap`：enum 外は既定 `"battlement"`。
- `shape`：`"round"` は `"square"` に縮退し**警告**。enum 外も square。
- `taper`：非 0 は**警告**して捨てる（IR に載せない）。
- `door.position`：数値は `1..w-2` にクランプ。"center" は `floor((w-1)/2)`。
- `windows.count/sill/span`：範囲にクランプ。
- `facing`：enum。"auto" はプレイヤー yaw から4方位にスナップ。
- パラメータ不正やスキーマ不一致は **施工せずゲーム内チャットで失敗通知**（無言失敗禁止）。

---

## 6. コンポーネント詳細仕様（v2差分）

### 6.1 C2: Claude APIクライアント（プロンプト更新）

- システムプロンプトに **box/house/tower の3スキーマ**を提示。選択指針を3択に拡張：「居住物→house」「縦に細長く高い建造物（塔・櫓・灯台・要塞の塔）→tower」「単純な塊→box」。
- tower 指針：「上部は城壁風なら cap:"battlement"、平らな屋上なら cap:"flat"、迷ったら battlement」「素材は基本 style:"stone"、窓は縦長 slit」「shape は square のみ」。
- 出力パース・検証・1回リトライ・失敗通知は v0/v1 と同じ枠組み。

### 6.2 原点・facing解決

- v1 の `planPlacement(player, yaw, w, d, explicitFacing?)` を**そのまま流用**。正方形 footprint（w==d）は回転で寸法が変わらず最も安全。w≠d でも house と同経路。
- `facing:"auto"` はプレイヤー yaw から4方位へスナップし、正面壁（lz=0・ドア側）がプレイヤーを向く。

### 6.3 C3: `buildTower(ir, origin)` 施工仕様 ★中核★

`build(ir, origin)` の `case "tower"` から呼ぶ。**全てローカル空間で組み、最後に `transformBuilding` でワールド化**。

#### 施工順序（後工程が前工程を上書きして開口を作る）

1. **palette解決**（style 既定 stone）＆ facing 解決。
2. **床**：`ly=0` を `palette.floor` で fill（house の `floor` を共用）。
3. **四方の壁**：`ly∈[1,h]` を `palette.wall` で fill（house の `walls` を共用、内部 air・天井なし）。
4. **隅柱(trim)**：4隅の垂直エッジを `palette.trim`（既定 wall）で上書き（house の `corners` を共用）。
5. **ドア開口**：正面壁(lz=0)に幅1×高2の air（house の `carveDoor`/`doorXOf` を共用）。
6. **縦スリット**：`pattern:"slit"` のとき各面に幅1×縦 span の glass を等間隔配置。正面は doorX 列を除外（R5）。`evenPositions` を共用。
7. **上部処理**：cap に応じて生成（下記）。

#### 上部処理：flat cap

- `ly=h+1` に footprint 1 層を `palette.roof` で fill（塔上部を閉じる）。

#### 上部処理：battlement（胸壁）

- `ly=h+1` に外周リング（4辺）を `palette.roof` で fill（屋上の歩廊＝土台、内側は開いたまま）。
- `ly=h+2` に外周セルを **1つおきに merlon として point で立てる**。判定は `(lx+lz)%2===0` または四隅。**四隅は必ず立て、頂点欠けを防ぐ**。
- merlon は point なので回転 min/max 問題（R2）の対象外（個別 `toWorld`）。

#### 共通

- 各 fill 領域・各点を `transformBuilding(ops, facing, origin, w, d)` でワールド化（fill は両角変換→min/max 再計算→体積分割、point は setblock）。
- 返り値 `BuildResult.region` は cap/merlon 頂を含む全体のワールドAABB（Undo用）。

### 6.4 共有プリミティブ（house.ts から export）

`fillOp`/`floor`/`walls`/`corners`/`carveDoor`/`doorXOf`/`evenPositions` を export し、tower.ts が import する。`doorXOf` の引数型は構造的型 `{ door?: { position?: "center" | number } }` に緩め、house/tower 双方で使える。

### 6.5 C4: Undoマネージャ（差分なし）

tower の `BuildResult.region`（cap/merlon 含む全体AABB）を air で埋め戻すだけ。ロジックは v0/v1 のまま。

---

## 7. 機能要件（v2・番号はv1から継続）

> v0/v1の FR-01〜FR-26 は引き続き有効。以下を追加。

| ID | 要件 | 受け入れ観点 |
|---|---|---|
| FR-27 | IRに `tower` 型を追加し、`box`/`house` も従来どおり動作する | 3タイプとも建つ（後方互換） |
| FR-28 | AIが塔の指示で `tower` 型のパラメータJSONを返す | 妥当な tower IR が得られる |
| FR-29 | `buildTower` が床・四方の壁・隅柱を決定論生成する | 閉じた塔状の躯体が建つ |
| FR-30 | 正面壁に幅1×高さ2のドア開口を空ける | 出入りできる開口がある |
| FR-31 | `cap:"flat"` で平天井の蓋を生成する | 塔上部が閉じる |
| FR-32 | `cap:"battlement"` で胸壁（交互の merlon）を生成する | 城壁風のギザギザになり四隅が立つ |
| FR-33 | `windows:"slit"` で縦スリットを等間隔配置・ドアと衝突しない | 狭間が規則的に並ぶ |
| FR-34 | `shape:"round"`/`taper` は square/0 に縮退し警告（落ちない） | 未対応指定でもクラッシュしない |
| FR-35 | tower 寸法を§5.4の範囲にクランプする | 極端値でもクラッシュしない |
| FR-36 | Undo領域が cap/merlon 頂を含む全体を覆う | Undoで塔が完全に消える |
| FR-37 | `transformBuilding`（旧 transformHouse）が tower でも min/max 正しい | 回転しても形状が崩れない |
| FR-38 | IRに `wall` 型を追加し、本体スラブ・門開口・胸壁を決定論生成する | 直線の防壁が建つ |
| FR-39 | `wall` の `crenellation` で上部に 1 つおきの merlon を立てる | 城壁風のギザギザになる |
| FR-40 | `wall` の `gate` で幅×高の air 開口を空ける | 通用門を通れる |
| FR-41 | IRに `bridge` 型を追加し、桁・欄干・橋脚を決定論生成する | 水平な橋が架かる |
| FR-42 | `bridge` の `piers` で deck 下（ly<0）へ橋脚を降ろす | 橋脚が下方向に伸びる |
| FR-43 | wall/bridge の寸法を範囲にクランプする（極端値でも落ちない） | クラッシュしない |
| FR-44 | Undo 領域が wall の胸壁・bridge の橋脚（負 y）を含む | Undoで全体が消える |

---

## 8. 非機能要件（v2差分）

- v0/v1の非機能要件（ロギング・耐障害・設定外出し・秘匿情報）は継続。
- ロギングに **解決後palette・facing・cap・寸法**を追加。
- `buildTower` は床/壁/隅柱/ドア/スリット/cap の**小関数に分割**して実装（テスト容易性と将来再利用のため）。house と同水準の決定論性・テスト網羅。

---

## 9. 完了条件（Acceptance Criteria・v2）

| ID | 条件 |
|---|---|
| AC-16 | 「塔を建てて」で、床・四方壁・ドア開口・縦スリット・cap を持つ塔がプレイヤー付近に出現する |
| AC-17 | `cap:"battlement"` で胸壁が交互に並び、四隅が立ち、頂部で閉じる |
| AC-18 | style もしくは palette により、壁・床・cap が異なる素材で塗り分けられる |
| AC-19 | ドアがプレイヤー側（正面）を向いており、1×2で通り抜けられる |
| AC-20 | v1の house・v0の box が従来どおり動く（リグレッション無し） |
| AC-21 | Undoで cap を含む塔全体が air に戻る |
| AC-22 | 極端な寸法・`shape:"round"`/`taper` 指定・不正素材でもクラッシュせず、クランプ／縮退／フォールバックして建つ |
| AC-23 | `build(ir, origin)` の署名がv0から不変で、各 IR が絶対座標を含まない |
| AC-24 | 「壁を建てて」で長い直線の防壁（胸壁・任意の門）が出現し、Undoで消える |
| AC-25 | 「橋を架けて」で桁・欄干・橋脚を持つ橋が出現し、Undoで橋脚を含め消える |

---

## 10. 技術スタック

v0/v1から変更なし。TypeScript（ユニオン型 `BoxIR | HouseIR | TowerIR` と網羅チェックの恩恵）。`tower.ts` は house.ts のプリミティブを import して構成。

---

## 11. 既知のリスク・要確認事項（v2）

| # | 項目 | 内容・対処 |
|---|---|---|
| R2 再 | 回転変換の min/max | 壁/床/cap は fill→`transformBuilding` が両角変換後 min/max 再計算で安全。merlon は point なので個別 `toWorld`、min/max 問題の対象外。正方形 footprint は回転で寸法不変。 |
| R7 再 | fill体積上限 | footprint≤16²=256、height48 の縦壁 fill も 16×48=768、スリットは 1×span。全て上限（32768）内。`fillCommands` 分割は保険。 |
| R-tower-1 | battlement の頂点欠け | footprint の偶奇で頂点 merlon が欠ける恐れ → 四隅は必ず立てる規則で対処。テストで固定（FR-32）。 |
| R-tower-2 | facing自動の正しさ | 正方形 footprint は回転で寸法不変＝最も安全。w≠d は house と同経路。45°境界のブレは実機で確認。 |
| R-tower-3 | スコープ漏れ | round/taper は enum/optional で受けるが**実装しない**（縮退＋警告）。AIに voxel/座標を出させない原則は厳守。 |

---

## 付録A：buildTower 擬似コード（骨子）

```ts
function buildTower(ir: TowerIR, origin: Vec3): BuildResult {
  const { palette } = resolvePalette({ palette: ir.palette, style: ir.style ?? "stone" });
  const facing = ir.facing !== "auto" ? ir.facing : "south";
  const { w, d } = ir.footprint, h = ir.height;

  const ops: LocalOp[] = [];
  floor(ops, w, d, palette.floor);              // ly=0（house と共用）
  walls(ops, w, d, h, palette.wall);            // ly=1..h、4面（共用）
  corners(ops, w, d, h, palette.trim ?? palette.wall); // 隅柱（共用）
  carveDoor(ops, doorXOf(ir, w));               // 正面 1x2 air（共用）
  if (windows === "slit") placeSlits(ops, w, d, h, ir, doorX, palette.window); // tower 固有
  if (cap === "flat") flatCap(ops, w, d, h, palette.roof);
  else battlementCap(ops, w, d, h, palette.roof, palette.trim); // tower 固有

  return transformBuilding(ops, facing, origin, w, d); // 共用変換
}
```

---

## 付録B：v2完了後の次の一歩（参考・v3予告）

- `shape:"round"`（円形断面の近似）と `taper`（先細り）を実装し、塔の表現力を上げる。
- `build()` の switch に `case "bridge"` / `case "wall"` 等を追加し、各タイプをパラメトリック生成器としてライブラリ化。tower で作った placeSlits/cap 等の部品を再利用。
- 自由形状が要るケースのみ `case "grid"` をエスケープハッチとして限定導入。
- いずれも `build(ir, origin)` の署名は不変のまま。v0で引いた seam の投資が継続して効く。
