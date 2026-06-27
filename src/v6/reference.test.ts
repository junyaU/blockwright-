import { describe, it, expect } from "vitest";
import { parseVisionScores, identifyReference, type IdentifyDeps, type VisionScore } from "./reference.js";

describe("parseVisionScores (FR-89)", () => {
  it("{scores:[...]} を採点配列へ", () => {
    const r = parseVisionScores(
      { scores: [{ index: 0, match: 0.9, single: 1, clean: 1, frontal: 1, score: 0.92 }] },
      2,
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ index: 0, score: 0.92 });
  });

  it("素の配列も受理", () => {
    const r = parseVisionScores([{ index: 1, match: 0.5, score: 0.5 }], 2);
    expect(r).toHaveLength(1);
    expect(r[0]!.index).toBe(1);
  });

  it("範囲外 index は除外（件数照合）", () => {
    const r = parseVisionScores([{ index: 5, score: 0.9 }], 2);
    expect(r).toHaveLength(0);
  });

  it("score 欠落は加重平均（match 重視）", () => {
    const r = parseVisionScores([{ index: 0, match: 1, single: 0, clean: 0, frontal: 0 }], 1);
    expect(r[0]!.score).toBeCloseTo(0.55, 5);
  });

  it("0..1 にクランプ", () => {
    const r = parseVisionScores([{ index: 0, match: 9, single: -1, clean: 1, frontal: 1, score: 7 }], 1);
    expect(r[0]!.score).toBe(1);
    expect(r[0]!.match).toBe(1);
    expect(r[0]!.single).toBe(0);
  });

  it("壊れ/非配列は空", () => {
    expect(parseVisionScores(null, 3)).toEqual([]);
    expect(parseVisionScores({ nope: 1 }, 3)).toEqual([]);
    expect(parseVisionScores("[]", 3)).toEqual([]);
  });
});

/** 注入フェイク：fetchBytes は url を、prepareThumb は bytes をそのまま base64 代わりに通す。 */
function fakeDeps(over: {
  candidates: string[];
  scores: VisionScore[] | (() => never);
  capture?: { savedBytes?: Buffer; savedName?: string };
  failThumb?: boolean;
}): Partial<IdentifyDeps> {
  return {
    normalize: async (s) => s,
    adapter: { search: async () => over.candidates.map((url) => ({ url })) },
    fetchBytes: async (url) => Buffer.from(url),
    prepareThumb: async (bytes) => {
      if (over.failThumb) throw new Error("decode failed (webp)");
      return bytes.toString("utf8");
    },
    verifier: {
      score: async () => (typeof over.scores === "function" ? over.scores() : over.scores),
    },
    saveImage: (bytes, name) => {
      if (over.capture) {
        over.capture.savedBytes = bytes;
        over.capture.savedName = name;
      }
      return `/saved/${name}.png`;
    },
  };
}

describe("identifyReference (FR-89・AC-55)", () => {
  it("先頭でなくても最高スコアが選ばれる（vision 再ランク）", async () => {
    const capture: { savedBytes?: Buffer; savedName?: string } = {};
    const ref = await identifyReference(
      "Tokyo Tower",
      { strict: true },
      fakeDeps({
        candidates: ["u0", "u1", "u2"],
        scores: [
          { index: 0, match: 0.5, single: 0.5, clean: 0.5, frontal: 0.5, score: 0.5 },
          { index: 1, match: 0.95, single: 1, clean: 1, frontal: 1, score: 0.95 },
          { index: 2, match: 0.4, single: 0.4, clean: 0.4, frontal: 0.4, score: 0.4 },
        ],
        capture,
      }),
    );
    expect(ref).not.toBeNull();
    expect(ref!.confident).toBe(true); // 0.95 >= 0.7（strict）
    expect(ref!.score).toBe(0.95);
    expect(ref!.path).toBe("/saved/tokyo_tower.png");
    // 選ばれたのは index1 = "u1" の生バイト。
    expect(capture.savedBytes?.toString("utf8")).toBe("u1");
  });

  it("全候補が低スコアなら confident:false（参照は返すが router が §6.5 へ）", async () => {
    const ref = await identifyReference(
      "Tokyo Tower",
      { strict: true },
      fakeDeps({
        candidates: ["u0", "u1"],
        scores: [
          { index: 0, match: 0.3, single: 0.3, clean: 0.3, frontal: 0.3, score: 0.3 },
          { index: 1, match: 0.35, single: 0.35, clean: 0.35, frontal: 0.35, score: 0.35 },
        ],
      }),
    );
    expect(ref).not.toBeNull();
    expect(ref!.confident).toBe(false);
    expect(ref!.score).toBe(0.35);
  });

  it("候補ゼロ → null", async () => {
    const ref = await identifyReference("Nonexistent", { strict: true }, fakeDeps({ candidates: [], scores: [] }));
    expect(ref).toBeNull();
  });

  it("vision が例外 → 先頭候補に決定論フォールバック（confident:false）", async () => {
    const ref = await identifyReference(
      "Tokyo Tower",
      { strict: true },
      fakeDeps({
        candidates: ["u0", "u1"],
        scores: () => {
          throw new Error("vision API down");
        },
      }),
    );
    expect(ref).not.toBeNull();
    expect(ref!.confident).toBe(false);
    expect(ref!.path).toBe("/saved/tokyo_tower.png");
  });

  it("全候補がデコード不可 → null（webp/avif）", async () => {
    const ref = await identifyReference(
      "Tokyo Tower",
      { strict: true },
      fakeDeps({ candidates: ["u0", "u1"], scores: [], failThumb: true }),
    );
    expect(ref).toBeNull();
  });
});
