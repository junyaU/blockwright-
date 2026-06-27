import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { time } from "./log.js";

/** timing ログ（log.info → console.log）を捕まえて、最後の timing レコードを取り出す。 */
function lastTiming(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const line = spy.mock.calls.map((c) => String(c[0])).reverse().find((s) => s.includes("INFO  timing"));
  if (!line) throw new Error("timing ログが出ていない");
  const json = line.slice(line.indexOf("{"));
  return JSON.parse(json);
}

describe("time（v7 観測層・ステージ計時）", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    spy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    spy.mockRestore();
  });

  it("fn の戻り値をそのまま返す", async () => {
    const r = await time("s", async () => 42);
    expect(r).toBe(42);
  });

  it("成功時は outcome=ok と ms(>=0) を残す", async () => {
    await time("acquireImage", async () => "ok");
    const rec = lastTiming(spy);
    expect(rec.stage).toBe("acquireImage");
    expect(rec.outcome).toBe("ok");
    expect(typeof rec.ms).toBe("number");
    expect(rec.ms as number).toBeGreaterThanOrEqual(0);
  });

  it("meta（mode 等）を timing に載せる", async () => {
    await time("gridFromGlb", async () => 1, { mode: "cache-hit" });
    expect(lastTiming(spy).mode).toBe("cache-hit");
  });

  it("例外時は再 throw しつつ outcome=fail を残す（時間を取りこぼさない）", async () => {
    await expect(
      time("generate3D", async () => {
        throw new Error("meshy timeout");
      }),
    ).rejects.toThrow("meshy timeout");
    const rec = lastTiming(spy);
    expect(rec.stage).toBe("generate3D");
    expect(rec.outcome).toBe("fail");
  });
});
