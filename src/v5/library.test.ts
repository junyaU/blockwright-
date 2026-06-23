import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Library } from "./library.js";
import type { GridIR } from "../ir.js";

function robot(): GridIR {
  return {
    type: "grid",
    size: { w: 2, h: 1, d: 2 },
    voxels: [[[1, 0], [0, 1]]],
    palette: { 1: "minecraft:pink_wool" },
    facing: "north",
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "v5lib-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("Library", () => {
  it("save → load の往復で GridIR が一致する", () => {
    const lib = new Library(dir);
    lib.save("robot", "Robot", robot());
    const loaded = lib.load("robot");
    expect(loaded).toEqual(robot());
  });

  it("find は subject 正規化（slug）でヒットする", () => {
    const lib = new Library(dir);
    lib.save("robot", "Robot", robot());
    expect(lib.find("Robot")).toBe("robot");
    expect(lib.find("robot")).toBe("robot");
    expect(lib.find("Dragon")).toBeNull();
  });

  it("index は別インスタンスでも永続化される", () => {
    new Library(dir).save("robot", "Robot", robot());
    const lib2 = new Library(dir);
    expect(lib2.find("Robot")).toBe("robot");
    expect(lib2.load("robot")).toEqual(robot());
  });

  it("maybeSave は既存 subject をスキップする", () => {
    const lib = new Library(dir);
    const first = lib.maybeSave("Robot", robot());
    const second = lib.maybeSave("Robot", robot());
    expect(first).toBe("robot");
    expect(second).toBe("robot");
    expect(lib.list().length).toBe(1);
  });

  it("壊れた asset は load で null（落ちない・R6）", () => {
    const lib = new Library(dir);
    lib.save("broken", "Broken", robot());
    writeFileSync(join(dir, "broken.json.gz"), Buffer.from("not gzip at all"));
    expect(lib.load("broken")).toBeNull();
  });

  it("壊れた index でも空で起動する", () => {
    writeFileSync(join(dir, "index.json"), "{ this is not valid json");
    const lib = new Library(dir);
    expect(lib.list()).toEqual([]);
  });
});
