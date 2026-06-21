# assets/ — v3 ボクセル化の入力リファレンス

`!voxelize <file> <size> [thickness|fill]` 開発コマンドが読むリファレンス置き場。
**通常の LLM チャット経路とは分離**しており、AI は形（占有）に一切関与しない（§v3 R1）。

## 使い方（ゲーム内チャット）

- 画像（v3.0）：`!voxelize creeper.png 16 2`
  - `<size>` = 最長辺のブロック数、3 つ目 = 厚み（既定 1）。アルファ透過は air。
- 3Dモデル（v3.1）：`!voxelize kirby.glb 20 solid`
  - `<size>` = 高さのブロック数、3 つ目 = `solid`（既定）/ `shell`。

設置後は「もどして」で全体（grid 全体 AABB）を取り消せる。

## 同梱物

- `creeper.png` … v3.0 デモ用の 8×8 ドット絵（`scripts/gen-creeper.ts` で再生成可能）。

## 3Dモデルを試す

`.obj` / `.glb` / `.gltf` をこのディレクトリに置いて `!voxelize <file> <height>`。
容量の大きいモデルはリポジトリにコミットせず、各自で配置する想定。
対応色は full・opaque・solid・非重力ブロックのみ（concrete / wool / terracotta が主、`src/voxelize/blocks.json`）。
