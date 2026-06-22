/**
 * §6.3 v5 修正解釈（AI＝言語のみ・FR-73/83）。
 *
 * フォローアップ発話と「現在の対象」のメタ（size・palette の色一覧）から EditOp を作る。
 * ★AI は言語分類とパラメータ抽出（recolor の from 選択＝palette 割当）のみ。
 *   voxel の占有・座標・形には一切触れない（R1）。
 * ★曖昧・形を変える依頼は安い変形に倒さず regen（作り直し）に寄せる（R2 / FR-81）。
 * Claude 呼び出しは interpret、判定パースは pure な parseEditOp（テスト対象）。
 */
import type Anthropic from "@anthropic-ai/sdk";
import { getClient } from "../claude.js";
import { config } from "../config.js";
import { log } from "../log.js";

/** recolor の from に使う色ヒント（palette の素材名に対する部分一致 / "all"）。 */
export type ColorHint = string;

/** move の方向（プレイヤー視点の相対方向）。 */
export type MoveDir = "left" | "right" | "forward" | "back" | "up" | "down";
export interface PlacementHint {
  dir: MoveDir;
  /** 移動ブロック数。省略時は既定（3）。 */
  amount?: number;
}

/** recolor の 1 マッピング。from=palette index（AI が選ぶ）or 色ヒント、to=BEブロックID。 */
export interface RecolorMap {
  from: number | ColorHint;
  to: string;
}

/**
 * 修正操作（§6.3）。安い修正は決定論変形、regen のみ v4 再生成（高い）。
 * none＝修正意図なし（無視）。曖昧・形変更は regen に寄せる。
 */
export type EditOp =
  | { kind: "new"; subject: string; size?: number }
  | { kind: "recolor"; mapping: RecolorMap[] }
  | { kind: "rescale"; targetSize: number }
  | { kind: "mirror"; axis: "x" | "z" }
  | { kind: "rotate"; quarterTurns: 1 | 2 | 3 }
  | { kind: "move"; placement: PlacementHint }
  | { kind: "delete" }
  | { kind: "regen"; modifiedSubject: string }
  | { kind: "none" };

/** 現在対象のメタ（AI に渡す。voxel の占有/座標は渡さない＝R1）。 */
export interface CurrentMeta {
  size: { w: number; h: number; d: number };
  /** palette index → BEブロックID。AI が recolor の from を選ぶ材料。 */
  palette: Record<number, string>;
  /** index → ブロック数（ヒストグラム）。最多 index ＝主要色（体など）の手がかり。 */
  counts?: Record<number, number>;
}

const SYSTEM_PROMPT = `あなたは Minecraft 建築アシスタントの「修正意図」分類器です。
ユーザーは直前に建てた立体（現在の対象）に対して修正を依頼します。
発話と現在対象のメタ（サイズ・palette）から、次の EditOp の JSON だけを出力してください。
★あなたは言語分類とパラメータ抽出だけを行います。ブロックの座標・voxel・形は一切出力しません。

EditOp（kind で判別）:
- 色替え:   { "kind": "recolor", "mapping": [ { "from": <palette index 整数> または "<色/素材ヒント>" または "all", "to": "<BEブロックID 例 minecraft:blue_concrete>" } ] }
- 大きさ:   { "kind": "rescale", "targetSize": <最長辺の目標ブロック数 整数 1..64> }
- 反転:     { "kind": "mirror", "axis": "x" | "z" }   // x=左右反転, z=前後反転
- 回転:     { "kind": "rotate", "quarterTurns": 1 | 2 | 3 }   // 反時計回り90°単位
- 移動:     { "kind": "move", "placement": { "dir": "left"|"right"|"forward"|"back"|"up"|"down", "amount": <整数 省略可> } }
- 削除:     { "kind": "delete" }
- 作り直し: { "kind": "regen", "modifiedSubject": "<英語の検索語＋変更内容>" }   // 形を変える依頼
- 新規:     { "kind": "new", "subject": "<英語の検索語>", "size": <整数 省略可> }
- 何もしない: { "kind": "none" }

重要な判断ルール:
- 色だけ変える＝recolor。大きさだけ＝rescale。向き＝rotate/mirror/move。これらは「形（占有）を変えない安い修正」。
- ★形を変える依頼（帽子をかぶせる・別物にする・ポーズを変える・パーツを足す/削る等）は必ず "regen"。安い修正に倒さないこと。
- ★安い修正か形変更か迷ったら "regen" に寄せる（誤って形を壊さない）。
- 修正と無関係な発話は "none"。

recolor（色替え）の from の選び方 ★重要★:
- 現在対象の palette（index→ブロックID）と counts（index→ブロック数）を見て、変えたい色の index（整数）を mapping.from に選ぶ。ブロックIDの色名（pink/red/blue 等）が手がかり。
- 「○○を青くして」のように部位を言わず色だけ指定した場合は、★counts が最も多い主要色の index（体。1〜2 個まで。似た色味でまとまるなら複数可）だけを対象にする。足・目・口など少数 index は残す。決して "all" にしない（全部塗ると別物になる）。
- 「足を赤く」「ほっぺをピンクに」など部位＋色なら、palette の色からそれらしい index を選ぶ（近似で可・R4）。
- "all"（全 index）は「全部」「全身」「丸ごと」と明示されたときだけ。

向きの依頼の解釈 ★重要★:
- 「回して」「向きを変えて」「向きを反転」「逆向き」「後ろを向かせて」→ rotate。180°相当（逆向き/反対）は quarterTurns:2、右/左 90°は 1 か 3。
- 「左右を入れ替える」「鏡像」と明示されたときだけ mirror axis:"x"。「前後を入れ替える」は mirror axis:"z"。
- 注意：左右対称な対象は mirror では見た目が変わらない。向きを変えたい意図なら rotate を優先する。

出力は JSON オブジェクト 1 個だけ。前置き・後置き・説明・コードフェンス禁止。`;

/** Claude 出力から JSON 本体（最初の { 〜 最後の }）を取り出す。 */
function extractJson(text: string): string {
  const t = text.trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  return start !== -1 && end > start ? t.slice(start, end + 1) : t;
}

function asInt(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : undefined;
}

/** 任意の値 → EditOp（不正・未知は安全側 none＝何もしない）。テスト対象の pure 関数。 */
export function parseEditOp(raw: unknown): EditOp {
  if (typeof raw !== "object" || raw === null) return { kind: "none" };
  const o = raw as Record<string, unknown>;

  switch (o.kind) {
    case "new": {
      if (typeof o.subject !== "string" || o.subject.trim() === "") return { kind: "none" };
      const size = asInt(o.size);
      return { kind: "new", subject: o.subject.trim(), ...(size !== undefined ? { size } : {}) };
    }
    case "recolor": {
      if (!Array.isArray(o.mapping)) return { kind: "none" };
      const mapping: RecolorMap[] = [];
      for (const m of o.mapping) {
        if (typeof m !== "object" || m === null) continue;
        const mm = m as Record<string, unknown>;
        if (typeof mm.to !== "string" || mm.to.trim() === "") continue;
        let from: number | string;
        if (typeof mm.from === "number" && Number.isFinite(mm.from)) from = Math.round(mm.from);
        else if (typeof mm.from === "string" && mm.from.trim() !== "") from = mm.from.trim();
        else continue;
        mapping.push({ from, to: mm.to.trim() });
      }
      return mapping.length > 0 ? { kind: "recolor", mapping } : { kind: "none" };
    }
    case "rescale": {
      const t = asInt(o.targetSize);
      return t !== undefined && t >= 1 ? { kind: "rescale", targetSize: t } : { kind: "none" };
    }
    case "mirror": {
      return o.axis === "x" || o.axis === "z" ? { kind: "mirror", axis: o.axis } : { kind: "none" };
    }
    case "rotate": {
      const q = asInt(o.quarterTurns);
      return q === 1 || q === 2 || q === 3 ? { kind: "rotate", quarterTurns: q } : { kind: "none" };
    }
    case "move": {
      const p = o.placement;
      if (typeof p !== "object" || p === null) return { kind: "none" };
      const pp = p as Record<string, unknown>;
      const dirs: MoveDir[] = ["left", "right", "forward", "back", "up", "down"];
      if (!dirs.includes(pp.dir as MoveDir)) return { kind: "none" };
      const amount = asInt(pp.amount);
      return {
        kind: "move",
        placement: { dir: pp.dir as MoveDir, ...(amount !== undefined && amount > 0 ? { amount } : {}) },
      };
    }
    case "delete":
      return { kind: "delete" };
    case "regen": {
      if (typeof o.modifiedSubject !== "string" || o.modifiedSubject.trim() === "") return { kind: "none" };
      return { kind: "regen", modifiedSubject: o.modifiedSubject.trim() };
    }
    case "none":
      return { kind: "none" };
    default:
      return { kind: "none" };
  }
}

/** 発話＋現在対象メタを EditOp へ分類する。失敗時は安全側 none。 */
export async function interpret(utterance: string, meta: CurrentMeta): Promise<EditOp> {
  try {
    const userContent = `現在の対象メタ:\n${JSON.stringify(meta)}\n\nユーザーの発話:\n${utterance}`;
    const resp = await getClient().messages.create({
      model: config.model,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    log.info("修正解釈 生出力", text);
    const op = parseEditOp(JSON.parse(extractJson(text)));
    log.info("EditOp 分類", op);
    return op;
  } catch (e) {
    log.warn("修正解釈に失敗、none 扱い", String(e));
    return { kind: "none" };
  }
}
