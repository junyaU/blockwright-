import { describe, it, expect } from "vitest";
import { handleUnidentified, type UnidentifiedDeps } from "./policy.js";

/** say / buildFromImage の呼び出しを記録する素朴なフェイク（vi.mock を使わない＝リポジトリ流儀）。 */
function makeDeps(over: Partial<UnidentifiedDeps>): { deps: UnidentifiedDeps; said: string[]; built: string[] } {
  const said: string[] = [];
  const built: string[] = [];
  const deps: UnidentifiedDeps = {
    policy: "notify",
    subject: "Tokyo Tower",
    say: async (t) => {
      said.push(t);
    },
    buildFromImage: async (p) => {
      built.push(p);
      return true;
    },
    ...over,
  };
  return { deps, said, built };
}

describe("handleUnidentified (FR-90)", () => {
  it("notify：候補があっても通知して停止（建てない）", async () => {
    const { deps, said, built } = makeDeps({ policy: "notify" });
    await handleUnidentified("/tmp/best.png", deps);
    expect(built).toHaveLength(0);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("特定できませんでした");
  });

  it("flat：候補ありなら最良候補で建て、通知しない", async () => {
    const { deps, said, built } = makeDeps({ policy: "flat" });
    await handleUnidentified("/tmp/best.png", deps);
    expect(built).toEqual(["/tmp/best.png"]);
    expect(said).toHaveLength(0);
  });

  it("flat：建築に失敗したら通知に落とす", async () => {
    const { deps, said, built } = makeDeps({
      policy: "flat",
      buildFromImage: async (p) => {
        built.push(p);
        return false;
      },
    });
    await handleUnidentified("/tmp/best.png", deps);
    expect(built).toEqual(["/tmp/best.png"]);
    expect(said).toHaveLength(1);
  });

  it("flat：候補が無ければ通知（黙って建てない）", async () => {
    const { deps, said, built } = makeDeps({ policy: "flat" });
    await handleUnidentified(null, deps);
    expect(built).toHaveLength(0);
    expect(said).toHaveLength(1);
  });
});
