# 要件定義書：Minecraft統合版 AI建築システム v5

> 対象実装者：Claude Code
> 版：v5（ライブラリ＋会話的修正ループ ＝ "貯まる・直せる"建築）／前提：v0〜v4 実装済み
> 言語/環境：Node.js on WSL2、Minecraft Bedrock（Windows）
> 関連：`requirements_minecraft_ai_builder_v0〜v4.md`（本書はその差分・拡張）

---

## 0. このドキュメントの読み方（Claude Codeへの前提指示）

- 本書は **v0〜v4 への差分**。`build(ir, origin)` 署名不変・IRは絶対座標を持たない・buildGrid以降の不変、は継続。
- **v5の組織原理：GridIR を唯一の通貨にする。** 生成器はGridIRを産み、ライブラリはGridIRを貯め、修正はGridIRを変形し、`build()` はGridIRを建てる。すべての機能が **GridIRを作る/変える/しまう/建てる** に収束する。v0で引いた `build(ir, origin)` seam が、ここで「全機能の合流点」として完成する。
- **v5の狙いは「生成を良くする」ではなく「荒い生成を取り囲むシステムを良くする」。** 1枚絵→3D生成の精度には原理的天井がある。そこを追わず、**不完全な生成器の周りを優秀にする**（保存＋会話的修正）方向に張る。
- **最重要の切り分け（§2.2）**：
  - **安い修正（色/大きさ/位置/反転/回転）＝ キャッシュ済みGridIRの決定論変形**。生成器を呼ばない。
  - **高い修正（形を変える）＝ 生成器(v4)の再呼び出し**（非決定論・作り直し）。
- **AIは言語分類とpaletteマッピングのみ。voxelの占有・座標には一切触れない**（v3〜v4の原則を継続）。生成（形）が起きるのは v4 stage3 だけ、という封じ込めも維持。
- スコープを広げない（§5.2）。特にシーン合成（複数オブジェクト配置）はやらない。

---

## 1. 背景と目的

v4で「喋るだけで立体が建つ」は実現したが、(a) 一発勝負で直せない、(b) 毎回ネット取得＋生成し直しで無駄、という弱点があった。v5のゴールは、v4を**本丸として太らせる**こと：

- **直せる**：「もっと大きく」「青くして」「左向きに」「消して」に会話で応答する修正ループ。
- **貯まる**：生成済みGridIRをライブラリに保存し再利用。初回だけ生成（荒い・非決定論）、2回目以降はキャッシュから**決定論**で建つ。

荒さの一番の解毒剤は「生成精度」ではなく「**直せること＋貯まること**」。この2つでv4の荒さを実用域に引き上げる。

---

## 2. 設計思想

### 2.1 GridIR が唯一の通貨

```
                ┌──────────── ライブラリ（GridIRを貯める）────────────┐
                ▼                                                      │
発話 → [ディスパッチ] → new生成(v4) ─┐                                  │
                      → キャッシュ取得 ┤→ GridIR → [変形] → GridIR → build(ir,origin) → ゲーム
                      → 安い修正 ──────┘           ▲                    │
                      → 高い修正(v4再生成) ────────┘                    │
                      → move(origin変更) / delete(Undo)                 │
                                                                        ▼
                                                      （建てたGridIRをライブラリ＆セッションへ）
```

- 入口が何であれ（新規・キャッシュ・修正・再生成）、**出口は必ず GridIR → build()**。下流は不変。
- ライブラリ・修正・生成はすべて「GridIRをどう用意するか」の違いにすぎない。

### 2.2 安い修正 / 高い修正の段差 ★v5の肝★

| 区分 | 操作例 | 実現 | 決定論性 | 生成器呼び出し |
|---|---|---|---|---|
| **安い** | 色替え（recolor） | palette index 再マッピング | ◎決定論 | 不要 |
| 安い | 大きさ（rescale） | voxelグリッド再サンプリング | ◎決定論 | 不要 |
| 安い | 反転（mirror）/ 90°回転 | voxel軸操作 | ◎決定論 | 不要 |
| 安い | 移動（move） | **originを変えるだけ**（GridIR不変） | ◎決定論 | 不要 |
| 安い | 削除（delete） | 既存Undo（領域air埋め） | ◎決定論 | 不要 |
| **高い** | 形を変える（帽子追加・別物化・ポーズ） | v4生成器を再呼び出し | ✗非決定論（作り直し） | 必要 |

- 「決定論でやれることはAIに渡さない／生成器に渡さない」というプロジェクト一貫の精神を、修正ループにも適用。**形を触らない修正はすべてコードの決定論変形**で済ませる。
- 特に **move が `origin` 変更だけで済む**のは、v0で「IRは絶対座標を持たず origin は外から与える」と決めた seam の配当。

### 2.3 キャッシュ＝"自製のv3リファレンス"

- 初回生成したGridIRを保存すると、それは実質 **v3 でいう"リファレンスから作った決定論アセット"** になる。
- 2回目以降は生成（非決定論）を経由せず、ライブラリから**決定論ロード**で建つ。**生成の不確実性を初回だけに閉じ込める**効果がある。

---

## 3. 実行環境

- v0〜v4 から基本変更なし。
- **新規：永続ストレージ**。GridIRアセットを保存するライブラリ（例 `library/` にJSON、サイズ対策で gzip 可）。v0で「永続化は不要」としていたが、v5で**意図的に導入**する（ライブラリのため）。
- 個人・ローカル利用前提は継続（v4 §3）。

---

## 4. アーキテクチャ上の位置づけ

- v5が足すのは **ディスパッチャ／ライブラリ／修正解釈／決定論変形エンジン／セッション状態** の上位層。
- これらはすべて **v4以前の生成・v3のボクセル化・v2.xのbuildGrid・v0のbuild/Undo の上に乗る**。下流は一切再実装しない。
- 出口は常に GridIR。生成経路（v4）・キャッシュ経路（ライブラリ）・変形経路（修正）の**3入口が build() に合流**する。

---

## 5. スコープ

### 5.1 v5でやること（In Scope）

- **ライブラリ**：GridIRの保存/読込/一覧/命名、subjectによるキャッシュヒット。
- **セッション状態**：直近に建てた「現在の対象」（GridIR・origin・region）を保持し、修正の参照先にする。
- **修正解釈**：フォローアップ発話をAIが分類し EditOp 化（言語のみ）。
- **決定論変形エンジン**：recolor / rescale / mirror / rotate（move は origin、delete は Undo）。
- **高い修正の経路**：形変更は v4 を再呼び出し（非決定論・作り直し、明示）。
- **in-place 更新**：旧領域Undo → 新GridIRをbuild、で現在の対象を置き換え。
- 全経路の GridIR→build() 収束。

### 5.2 v5でやらないこと（Out of Scope：明示）

- **シーン合成／複数オブジェクトの同時管理**（「カービィの隣に家」「星を持ったカービィ」）。セッションは**単一の現在対象**のみ扱う。将来。
- **生成精度そのものの改善**（複数アングル取得等）。v5は「荒さを取り囲む」側に張る。別軸。
- **意味的に厳密な部分recolor**（「左足の靴だけ」等のピンポイント）。recolorは palette index/色クラスタ単位（§6.4）。
- **buildGrid以降（voxelize/build/Undo）の再実装**。不変。
- **AIによるvoxel生成**。一切なし（継続）。

### 5.3 将来拡張（設計余地）

- セッションを複数対象に拡張 → シーン合成（v6相当）。
- 変形エンジンに操作を追加（クロップ・結合・配列複製）。
- ライブラリ共有/インポート（個人利用の範囲で）。

---

## 6. コンポーネント詳細

### 6.1 ライブラリ（GridIR永続化）

- API：`save(name, gridIR, meta)` / `load(name) → gridIR` / `list()` / `find(subject) → name?`。
- 保存形式：GridIR(JSON)＋メタ（subject・size・作成日・palette概要）。dense voxelは肥大しうるので **gzip or run-length圧縮**を検討（v2.xのmerge表現を流用可）。
- **キャッシュキー**：subjectの正規化文字列（例 "kirby"）。サイズ違いはバリアント名 or キー付加で区別。
- **キャッシュヒット**：既知subjectの新規要求はライブラリから決定論ロードし、**生成を呼ばない**（FR-71）。

### 6.2 セッション状態

- 「現在の対象」を保持：`{ gridIR, origin, region, name }`。修正発話の「それ」「もっと〜」の参照先。
- 修正・削除・移動はこの現在対象に作用。新規建築で現在対象を更新。
- v5は**単一対象**（直近に建てたもの）。複数同時はスコープ外（§5.2）。

### 6.3 修正解釈（AI・言語のみ）

- 入力：フォローアップ発話 ＋ 現在対象のメタ（size・paletteの色一覧など、**voxelは渡さない**）。
- 出力：EditOp（判別可能ユニオン）：

```ts
type EditOp =
  | { kind: "new";     subject: string; size?: number }
  | { kind: "recolor"; mapping: { from: number | ColorHint; to: string }[] } // 安い
  | { kind: "rescale"; targetSize: number }                                  // 安い
  | { kind: "mirror";  axis: "x" | "z" }                                     // 安い
  | { kind: "rotate";  quarterTurns: 1 | 2 | 3 }                             // 安い
  | { kind: "move";    placement: PlacementHint }                            // 安い(origin)
  | { kind: "delete" }                                                       // 安い(Undo)
  | { kind: "regen";   modifiedSubject: string }                            // 高い(v4再生成)
```

- **AIは分類とパラメータ抽出のみ**。voxel占有・座標は生成しない。recolorの `from` 指定（どのindex/色を変えるか）はAIが palette 情報から選ぶ＝v3 §6.5 と同じ「色割当」の範囲。
- **曖昧な場合は作り直し(regen)寄り or 確認**（誤って安い変形で形を壊さない、§R2）。

### 6.4 決定論変形エンジン（安い修正）

すべて GridIR → GridIR の決定論変換。生成器を呼ばない。

- **recolor**：`mapping` に従い palette を差し替え/再マッピングして新paletteを作る。voxelの index 構造は基本そのまま（必要なら index 統合）。色は§6.4 v3 と同じ素材検証を通す。
- **rescale**：voxelグリッドを targetSize へ**再サンプリング**（最近傍 or ボックス平均→再量子化）。v2.xサイズ上限にクランプ。小特徴の消失は許容（§R3）。
- **mirror**：指定軸で `voxels[y][z][x]` を反転（x反転なら各行を逆順）。
- **rotate**：90°単位で voxel を回転（次元の入れ替え＋反転）。`facing` で建築時に回す方法もあるが、**アセットとして焼き込む**方を既定にすると一貫性が高い。
- **move**：GridIR不変。**originを変えて build し直すだけ**（§2.2）。
- **delete**：現在対象の region を既存Undoで air 埋め。

### 6.5 ディスパッチ＆in-place更新

- ディスパッチャがEditOpを経路へ振り分け：
  - new → ライブラリ find → ヒットでロード / ミスで v4生成 → build。
  - 安い修正 → 変形エンジン → 新GridIR。
  - regen → v4再呼び出し（modifiedSubjectで）→ 新GridIR。
  - move → 新origin。delete → Undo。
- **in-place 更新手順**（move/delete以外の修正）：
  1. 現在対象の region を Undo（air埋め）。
  2. 新GridIR を **同じorigin**（move時は新origin）で `build()`。
  3. セッションの現在対象（gridIR/origin/region）を更新。必要ならライブラリも更新/保存。
- これにより「直す＝旧を消して新を建てる」が全修正で統一される。残骸を残さない（§R5）。

### 6.6 高い修正（regen）の扱い

- 形変更（帽子・別物化・ポーズ等）は v4 を modifiedSubject で再実行。
- **非決定論＝作り直しであり、"微調整"ではない**ことをユーザーに明示（「形の変更は作り直しになります／見た目が変わることがあります」）。
- v4のフォールバック（破綻時は平面）もそのまま継承。

---

## 7. 機能要件（v5・番号は v4 から継続）

> v0〜v4 の FR は継続有効。以下を追加。

| ID | 要件 | 受け入れ観点 |
|---|---|---|
| FR-70 | GridIRをライブラリに保存/読込/一覧/命名できる | アセットが貯まる |
| FR-71 | 既知subjectの再要求はライブラリから決定論ロードし、生成を呼ばない | 2回目は即・無生成 |
| FR-72 | セッションが現在の対象(gridIR/origin/region)を保持し、修正の参照先になる | 「それ」を直せる |
| FR-73 | フォローアップ発話をAIが分類しEditOp化する（言語のみ・voxel不触） | 修正意図が取れる |
| FR-74 | recolor＝palette再マッピングで決定論変形する | 再生成せず色が変わる |
| FR-75 | rescale＝voxel再サンプリングで決定論変形する | 再生成せず大きさが変わる |
| FR-76 | mirror/rotate＝voxel軸操作で決定論変形する | 再生成せず向きが変わる |
| FR-77 | move＝origin変更のみでGridIR不変、build(ir,origin)で再配置する | 位置だけ動く |
| FR-78 | 形変更（高い修正）はv4再生成で行い、作り直しである旨を明示する | 期待が合う |
| FR-79 | 修正はin-place（旧領域Undo→新GridIR build）で対象を置き換える | 残骸が残らない |
| FR-80 | delete/取り消しは既存Undoで現在対象を消す | 消せる |
| FR-81 | 安い/高いの分類が曖昧なときは作り直し寄り or 確認する | 形を誤破壊しない |
| FR-82 | new/cache/edit/regen 全経路がGridIR→build()に収束する（下流不変） | 合流点が一つ |
| FR-83 | AIは言語分類とpaletteマッピングのみ。voxel占有/座標に触れない | 形に触れない |

---

## 8. 非機能要件（v5差分）

- v0〜v4 の非機能要件は継続。
- ロギングに **EditOp分類結果・経路（new/cache/edit/regen）・キャッシュヒット有無・変形種別・in-place更新の領域**を追加。
- ライブラリ：dense voxelの保存サイズに留意（圧縮）。破損時に読めない/落ちないよう堅牢に（壊れたアセットはスキップ＋通知）。
- 変形エンジン（recolor/rescale/mirror/rotate）は**単体テスト必須**（既知GridIN→期待GridOUT）。特に rescale の再量子化と rotate の軸入れ替えはバグりやすい。
- 修正解釈の分類は、安い/高いの誤分類が最も痛い（§R2）。ログで分類結果を可視化し閾値調整可能に。

---

## 9. 完了条件（Acceptance Criteria・v5）

| ID | 条件 |
|---|---|
| AC-45 | 「カービィ作って」2回目はライブラリから即・決定論で建つ（再生成しない） |
| AC-46 | 「もっと大きく」で再生成せず決定論リスケールで建て直る |
| AC-47 | 「青くして」で再生成せずpalette再マッピングで色が変わる |
| AC-48 | 「左右反転」「右に動かして」が決定論で効く（moveはorigin変更のみ） |
| AC-49 | 「帽子かぶせて」等の形変更は作り直しになり、その旨が伝わる |
| AC-50 | 修正はin-placeで、旧対象の残骸が残らない |
| AC-51 | `build(ir,origin)` 署名不変、全経路がGridIRに収束、buildGrid以降が再実装されていない |
| AC-52 | AIがvoxelを生成しない（言語分類＋palette割当のみ） |

---

## 10. 技術スタック（推奨）

- ライブラリ：JSON（＋gzip）でファイル保存、軽量インデックス（name→file/meta）。DBは不要（個人規模）。
- 修正解釈：Claude API（分類＋param抽出）。出力は EditOp の JSON のみ。
- 変形エンジン：純粋なGridIR→GridIR関数群（外部依存なし）。
- ディスパッチ/セッション：プロセス内状態＋ライブラリ永続。
- ファイル構成例：
  ```
  src/v5/
    library.ts     # GridIR 永続化（save/load/list/find）
    session.ts     # 現在対象の保持
    interpret.ts   # 発話→EditOp（AI言語）
    transform.ts   # recolor/rescale/mirror/rotate（決定論）
    dispatch.ts    # 経路振り分け＋in-place更新
  // 生成は v4、ボクセル化は v3、build/Undo は v2.x/v0 を再利用
  ```

---

## 11. 既知のリスク・要確認事項（v5）

| # | 項目 | 内容・対処 |
|---|---|---|
| R1 | AIにvoxelを触らせない | 継続。AIは分類＋palette割当のみ。変形は決定論コード。生成（形）はv4 stage3だけ。 |
| R2 | 安い/高いの誤分類 | 形変更を安い変形と誤れば原型崩壊、逆なら無駄に再生成。**迷ったら作り直し寄り/確認**（FR-81）。分類ログで調整。 |
| R3 | rescale の劣化 | 縮小で小特徴（目など）消失、拡大で粗大化。再量子化の質に注意。許容前提。 |
| R4 | 部分recolorの曖昧さ | 「体だけ青く」はindex/色クラスタ単位の近似。厳密な部位指定はスコープ外（§5.2）。 |
| R5 | in-place の残骸 | 旧regionのUndoが不正確だと建て替え時に残骸。v2.x全体AABB regionを正確に保持。 |
| R6 | ライブラリ肥大/破損 | dense voxelは大きい。圧縮＋壊れアセットの安全スキップ。キャッシュキー衝突に注意。 |
| R7 | regenの非決定論 | 形変更は別生成＝見た目が変わる。「微調整ではない」と明示（FR-78）。 |
| R8 | セッション参照の曖昧さ | 「それ」が何かは単一現在対象で一意化。複数対象（シーン合成）は持ち込まない（§5.2）。 |

---

## 付録A：ディスパッチ擬似コード

```ts
async function handleUtterance(utterance: string) {
  const op = await interpret(utterance, session.current?.meta);  // AI言語→EditOp

  switch (op.kind) {
    case "new": {
      const ir = library.find(op.subject)
        ? library.load(library.find(op.subject)!)                // キャッシュ：決定論
        : await generateViaV4(op.subject, op.size);              // 初回：生成（v4）
      return placeAsCurrent(ir, resolveOrigin());
    }
    case "recolor": case "rescale": case "mirror": case "rotate": {
      const ir = applyTransform(session.current.gridIR, op);     // 決定論変形
      return replaceCurrent(ir);                                 // in-place
    }
    case "move":   return replaceCurrent(session.current.gridIR, newOrigin(op)); // originだけ
    case "delete": return undo(session.current.region);
    case "regen": {
      const ir = await generateViaV4(op.modifiedSubject);        // 高い：作り直し
      notify("形の変更は作り直しになります");
      return replaceCurrent(ir);
    }
  }
}

// 共通：in-place（旧を消して新を建て、セッション/ライブラリ更新）
function replaceCurrent(ir, origin = session.current.origin) {
  undo(session.current.region);                                 // 旧領域を消す
  const result = build(ir, origin);                             // GridIR→build（不変）
  session.current = { gridIR: ir, origin, region: result.region };
  library.maybeSave(session.current);
}
```

形を作るのは `generateViaV4`（高い修正/新規生成）だけ。`applyTransform`・`build`・`undo`・library は全部決定論。

---

## 付録B：ロードマップ総括（v0→v5）

```
v0   箱（ループ＋seam）            build(ir,origin) を確立
v1   house（パラメトリック）         AI=設計, コード=施工
v2   タイプ複数化（生成器ライブラリ） AI=選択+穴埋め
v2.x grid（自由形状の器・密版）       器を先に固める
v3   ボクセル化（充填手段）           リファレンス→忠実に建てる
v4   喋るだけ（生成+取得+清掃+保険）   ★stage3でのみ決定論原則を破る
v5   ライブラリ＋修正ループ           ★GridIRを唯一の通貨にし、合流点を完成
```

- `build(ir, origin)` seam は **v0からv5まで一度も変えていない**。全バージョンは seam の上流に層を足しただけ。
- v5で「生成・取得・キャッシュ・変形・建築」がすべて **GridIRを介して合流**し、本丸（v4の生成）を **保存（貯まる）と会話的修正（直せる）で取り囲む**ことで、荒い生成を実用に変える——これがv5の到達点。