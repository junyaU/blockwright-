import { describe, it, expect } from "vitest";
import { parseEditOp } from "./interpret.js";

describe("parseEditOp", () => {
  it("recolor：数値 from と to を拾う", () => {
    expect(parseEditOp({ kind: "recolor", mapping: [{ from: 1, to: "minecraft:blue_concrete" }] })).toEqual({
      kind: "recolor",
      mapping: [{ from: 1, to: "minecraft:blue_concrete" }],
    });
  });

  it("recolor：to 欠けのエントリは捨て、空なら none", () => {
    expect(parseEditOp({ kind: "recolor", mapping: [{ from: 1 }] })).toEqual({ kind: "none" });
  });

  it("recolor：文字列 from（色ヒント）を許容", () => {
    expect(parseEditOp({ kind: "recolor", mapping: [{ from: "all", to: "minecraft:gold_block" }] })).toEqual({
      kind: "recolor",
      mapping: [{ from: "all", to: "minecraft:gold_block" }],
    });
  });

  it("rescale：targetSize を整数化", () => {
    expect(parseEditOp({ kind: "rescale", targetSize: 30.4 })).toEqual({ kind: "rescale", targetSize: 30 });
  });

  it("mirror：x/z のみ許容", () => {
    expect(parseEditOp({ kind: "mirror", axis: "x" })).toEqual({ kind: "mirror", axis: "x" });
    expect(parseEditOp({ kind: "mirror", axis: "y" })).toEqual({ kind: "none" });
  });

  it("rotate：1..3 のみ許容", () => {
    expect(parseEditOp({ kind: "rotate", quarterTurns: 1 })).toEqual({ kind: "rotate", quarterTurns: 1 });
    expect(parseEditOp({ kind: "rotate", quarterTurns: 4 })).toEqual({ kind: "none" });
    expect(parseEditOp({ kind: "rotate", quarterTurns: 0 })).toEqual({ kind: "none" });
  });

  it("move：dir を検証、amount は任意", () => {
    expect(parseEditOp({ kind: "move", placement: { dir: "right", amount: 5 } })).toEqual({
      kind: "move",
      placement: { dir: "right", amount: 5 },
    });
    expect(parseEditOp({ kind: "move", placement: { dir: "right" } })).toEqual({
      kind: "move",
      placement: { dir: "right" },
    });
    expect(parseEditOp({ kind: "move", placement: { dir: "nowhere" } })).toEqual({ kind: "none" });
  });

  it("delete / regen / new", () => {
    expect(parseEditOp({ kind: "delete" })).toEqual({ kind: "delete" });
    expect(parseEditOp({ kind: "regen", modifiedSubject: "robot with hat" })).toEqual({
      kind: "regen",
      modifiedSubject: "robot with hat",
    });
    expect(parseEditOp({ kind: "new", subject: "Dog", size: 20 })).toEqual({
      kind: "new",
      subject: "Dog",
      size: 20,
    });
  });

  it("不正・未知・非オブジェクトは安全側 none", () => {
    expect(parseEditOp(null)).toEqual({ kind: "none" });
    expect(parseEditOp("xyz")).toEqual({ kind: "none" });
    expect(parseEditOp({ kind: "explode" })).toEqual({ kind: "none" });
    expect(parseEditOp({ kind: "regen" })).toEqual({ kind: "none" });
    expect(parseEditOp({ kind: "new", subject: "  " })).toEqual({ kind: "none" });
  });
});
