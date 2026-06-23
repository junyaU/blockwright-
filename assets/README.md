# assets/ — v3 ボクセル化の入力リファレンス

`!voxelize <file> <size> [thickness|fill]` 開発コマンドが読むリファレンス置き場。
**通常の LLM チャット経路とは分離**しており、AI は形（占有）に一切関与しない（§v3 R1）。

## 使い方（ゲーム内チャット）

- 画像（v3.0）：`!voxelize sample.png 16 2`
  - `<size>` = 最長辺のブロック数、3 つ目 = 厚み（既定 1）。アルファ透過は air。
- 3Dモデル（v3.1）：`!voxelize model.glb 20 solid`
  - `<size>` = 高さのブロック数、3 つ目 = `solid`（既定）/ `shell`。

設置後は「もどして」で全体（grid 全体 AABB）を取り消せる。

## 入力ファイルの配置

- 画像（`.png` 等）や 3Dモデル（`.obj` / `.glb` / `.gltf`）をこのディレクトリに置いて `!voxelize <file> <height>`。
- 参照アセットは容量・権利の都合でリポジトリにコミットせず、各自で配置する想定。
- 対応色は full・opaque・solid・非重力ブロックのみ（concrete / wool / terracotta が主、`src/voxelize/blocks.json`）。
