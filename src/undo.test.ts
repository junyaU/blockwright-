import { describe, it, expect } from "vitest";
import { airFillCommands, UndoManager } from "./undo.js";

describe("airFillCommands", () => {
  it("体積上限以内は単一 fill", () => {
    const cmds = airFillCommands({ min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 2, z: 2 } });
    expect(cmds).toEqual(["fill 0 0 0 2 2 2 minecraft:air"]);
  });

  it("体積上限超過は CHUNK(32) で分割される", () => {
    // 64^3 は 32768 を超えるので分割される（各軸 2 分割 = 8 本）。
    const cmds = airFillCommands({ min: { x: 0, y: 0, z: 0 }, max: { x: 63, y: 63, z: 63 } });
    expect(cmds.length).toBe(8);
    expect(cmds.every((c) => c.endsWith("minecraft:air"))).toBe(true);
  });
});

describe("UndoManager は airFillCommands に委譲する（挙動不変）", () => {
  it("record した領域を air 埋めし、消費後は null", () => {
    const undo = new UndoManager();
    undo.record({ region: { min: { x: 1, y: 2, z: 3 }, max: { x: 4, y: 5, z: 6 } }, commands: [] });
    expect(undo.buildUndoCommands()).toEqual(["fill 1 2 3 4 5 6 minecraft:air"]);
    expect(undo.buildUndoCommands()).toBeNull(); // 消費済み
  });
});
