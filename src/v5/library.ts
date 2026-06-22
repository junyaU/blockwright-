/**
 * §6.1 v5 ライブラリ（GridIR 永続化・FR-70/71）。
 *
 * 生成済み GridIR をディスクに貯め、subject で再利用する（2 回目以降は決定論ロード）。
 * - 保存：`<dir>/<name>.json.gz`（dense voxel 肥大対策に gzip）＋ `<dir>/index.json`（name→meta）。
 * - キャッシュキー：subject の正規化文字列（slug）。find(subject) で name を引く。
 * - 堅牢性（R6）：壊れた/読めないアセットは throw せず skip＋warn。load は parseIR で再検証。
 *
 * Minecraft I/O には触れない（ローカルファイル I/O のみ）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { join } from "node:path";
import { type GridIR, parseIR } from "../ir.js";
import { slug } from "../pipeline/image.js";
import { log } from "../log.js";

export interface LibraryMeta {
  /** ファイル名のベース（拡張子なし）。 */
  name: string;
  /** 正規化前の subject（表示用）。 */
  subject: string;
  /** 正規化 subject（cache キー）。 */
  key: string;
  size: { w: number; h: number; d: number };
  /** palette の素材一覧（概要）。 */
  paletteSummary: string[];
  /** 作成時刻（epoch ms）。 */
  createdAt: number;
}

export class Library {
  private dir: string;
  private index: Map<string, LibraryMeta> = new Map(); // name → meta

  constructor(dir: string) {
    this.dir = dir;
    this.loadIndex();
  }

  private indexPath(): string {
    return join(this.dir, "index.json");
  }

  private assetPath(name: string): string {
    return join(this.dir, `${name}.json.gz`);
  }

  /** index.json をメモリへ読む。壊れていても落ちない（空で開始）。 */
  private loadIndex(): void {
    try {
      if (!existsSync(this.indexPath())) return;
      const raw = JSON.parse(readFileSync(this.indexPath(), "utf8"));
      if (!Array.isArray(raw)) return;
      for (const m of raw) {
        if (m && typeof m.name === "string" && typeof m.key === "string") {
          this.index.set(m.name, m as LibraryMeta);
        }
      }
    } catch (e) {
      log.warn("ライブラリ index 読込失敗（空で開始）", String(e));
    }
  }

  private persistIndex(): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.indexPath(), JSON.stringify([...this.index.values()], null, 2), "utf8");
  }

  /** subject（正規化）に一致する name を返す。無ければ null。 */
  find(subject: string): string | null {
    const key = slug(subject);
    for (const meta of this.index.values()) {
      if (meta.key === key) return meta.name;
    }
    return null;
  }

  /** name の GridIR をロード。壊れていれば skip して null（R6）。 */
  load(name: string): GridIR | null {
    try {
      const path = this.assetPath(name);
      if (!existsSync(path)) return null;
      const json = gunzipSync(readFileSync(path)).toString("utf8");
      const parsed = parseIR(JSON.parse(json));
      if (!parsed.ok || parsed.ir.type !== "grid") {
        log.warn("ライブラリ asset が不正、skip", { name, reason: parsed.ok ? "型不一致" : parsed.error });
        return null;
      }
      return parsed.ir;
    } catch (e) {
      log.warn("ライブラリ asset 読込失敗、skip", { name, error: String(e) });
      return null;
    }
  }

  /** GridIR を保存し index を更新する。 */
  save(name: string, subject: string, ir: GridIR): void {
    mkdirSync(this.dir, { recursive: true });
    const json = JSON.stringify(ir);
    writeFileSync(this.assetPath(name), gzipSync(Buffer.from(json, "utf8")));
    const meta: LibraryMeta = {
      name,
      subject,
      key: slug(subject),
      size: ir.size,
      paletteSummary: Object.values(ir.palette),
      createdAt: Date.now(),
    };
    this.index.set(name, meta);
    this.persistIndex();
    log.info("ライブラリ保存", { name, key: meta.key, size: meta.size });
  }

  /** subject 未登録なら保存する（既存はスキップ＝初回生成のみ貯める）。 */
  maybeSave(subject: string, ir: GridIR): string {
    const existing = this.find(subject);
    if (existing) return existing;
    const name = slug(subject);
    this.save(name, subject, ir);
    return name;
  }

  list(): LibraryMeta[] {
    return [...this.index.values()];
  }
}
