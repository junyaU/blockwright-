import { describe, it, expect } from "vitest";
import { parseIntent } from "./intent.js";

describe("parseIntent", () => {
  it("character + subject + targetHeight", () => {
    expect(parseIntent({ kind: "character", subject: "robot", targetHeight: 20 })).toEqual({
      kind: "character", subject: "robot", targetHeight: 20,
    });
  });

  it("character で targetHeight 省略", () => {
    expect(parseIntent({ kind: "character", subject: "dragon" })).toEqual({
      kind: "character", subject: "dragon",
    });
  });

  it("parametric はそのまま", () => {
    expect(parseIntent({ kind: "parametric" })).toEqual({ kind: "parametric" });
  });

  it("subject 欠落は parametric に倒す", () => {
    expect(parseIntent({ kind: "character" })).toEqual({ kind: "parametric" });
  });

  it("非オブジェクト/壊れた値は parametric", () => {
    expect(parseIntent(null)).toEqual({ kind: "parametric" });
    expect(parseIntent("robot")).toEqual({ kind: "parametric" });
  });

  it("targetHeight が数値でなければ無視", () => {
    expect(parseIntent({ kind: "character", subject: "golem", targetHeight: "tall" })).toEqual({
      kind: "character", subject: "golem",
    });
  });
});
