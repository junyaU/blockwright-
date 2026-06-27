import { describe, it, expect } from "vitest";
import { parseClassification } from "./classify.js";

describe("parseClassification (FR-84)", () => {
  it("specific + subject + confidence", () => {
    expect(parseClassification({ category: "specific", subject: "Tokyo Tower", confidence: 0.9 })).toEqual({
      category: "specific",
      subject: "Tokyo Tower",
      confidence: 0.9,
    });
  });

  it("generic + styleHint を取り込む", () => {
    expect(
      parseClassification({ category: "generic", subject: "house", styleHint: "european", confidence: 0.8 }),
    ).toEqual({ category: "generic", subject: "house", styleHint: "european", confidence: 0.8 });
  });

  it("size は明示時だけ・丸める", () => {
    expect(
      parseClassification({ category: "specific", subject: "Pikachu", size: 40.4, confidence: 0.7 }),
    ).toEqual({ category: "specific", subject: "Pikachu", size: 40, confidence: 0.7 });
  });

  it("size が数値でなければ無視", () => {
    expect(
      parseClassification({ category: "generic", subject: "tower", size: "tall", confidence: 0.6 }),
    ).toEqual({ category: "generic", subject: "tower", confidence: 0.6 });
  });

  it("confidence は 0..1 にクランプ", () => {
    expect(parseClassification({ category: "generic", subject: "wall", confidence: 9 }).confidence).toBe(1);
    expect(parseClassification({ category: "generic", subject: "wall", confidence: -3 }).confidence).toBe(0);
  });

  it("不正な category は曖昧に倒す", () => {
    expect(parseClassification({ category: "bogus", subject: "x", confidence: 0.5 }).category).toBe("ambiguous");
  });

  it("subject 欠落/空は曖昧・空 subject・confidence 0（後段ポリシーへ）", () => {
    expect(parseClassification({ category: "specific", confidence: 0.9 })).toEqual({
      category: "ambiguous",
      subject: "",
      confidence: 0,
    });
    expect(parseClassification({ category: "specific", subject: "   ", confidence: 0.9 })).toEqual({
      category: "ambiguous",
      subject: "",
      confidence: 0,
    });
  });

  it("非オブジェクト/壊れた値は安全側（曖昧・空・0）", () => {
    expect(parseClassification(null)).toEqual({ category: "ambiguous", subject: "", confidence: 0 });
    expect(parseClassification("Tokyo Tower")).toEqual({ category: "ambiguous", subject: "", confidence: 0 });
    expect(parseClassification({ confidence: 0.3 })).toEqual({ category: "ambiguous", subject: "", confidence: 0 });
  });
});
