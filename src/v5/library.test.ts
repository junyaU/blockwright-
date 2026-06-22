import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Library } from "./library.js";
import type { GridIR } from "../ir.js";

function kirby(): GridIR {
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
    lib.save("kirby", "Kirby", kirby());
    const loaded = lib.load("kirby");
    expect(loaded).toEqual(kirby());
  });

  it("find は subject 正規化（slug）でヒットする", () => {
    const lib = new Library(dir);
    lib.save("kirby", "Kirby", kirby());
    expect(lib.find("Kirby")).toBe("kirby");
    expect(lib.find("kirby")).toBe("kirby");
    expect(lib.find("Pikachu")).toBeNull();
  });

  it("index は別インスタンスでも永続化される", () => {
    new Library(dir).save("kirby", "Kirby", kirby());
    const lib2 = new Library(dir);
    expect(lib2.find("Kirby")).toBe("kirby");
    expect(lib2.load("kirby")).toEqual(kirby());
  });

  it("maybeSave は既存 subject をスキップする", () => {
    const lib = new Library(dir);
    const first = lib.maybeSave("Kirby", kirby());
    const second = lib.maybeSave("Kirby", kirby());
    expect(first).toBe("kirby");
    expect(second).toBe("kirby");
    expect(lib.list().length).toBe(1);
  });

  it("壊れた asset は load で null（落ちない・R6）", () => {
    const lib = new Library(dir);
    lib.save("broken", "Broken", kirby());
    writeFileSync(join(dir, "broken.json.gz"), Buffer.from("not gzip at all"));
    expect(lib.load("broken")).toBeNull();
  });

  it("壊れた index でも空で起動する", () => {
    writeFileSync(join(dir, "index.json"), "{ this is not valid json");
    const lib = new Library(dir);
    expect(lib.list()).toEqual([]);
  });
});
