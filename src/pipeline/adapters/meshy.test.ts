import { describe, it, expect } from "vitest";
import { parseMeshyStatus } from "./meshy.js";
import { parseSerpImages } from "./imageSearch.js";

describe("parseMeshyStatus", () => {
  it("SUCCEEDED は glbUrl を取り出す", () => {
    const r = parseMeshyStatus({ status: "SUCCEEDED", progress: 100, model_urls: { glb: "https://x/y.glb" } });
    expect(r.status).toBe("succeeded");
    expect(r.glbUrl).toBe("https://x/y.glb");
  });

  it("IN_PROGRESS は running", () => {
    expect(parseMeshyStatus({ status: "IN_PROGRESS", progress: 42 }).status).toBe("running");
  });

  it("PENDING は pending", () => {
    expect(parseMeshyStatus({ status: "PENDING" }).status).toBe("pending");
  });

  it("FAILED は failed", () => {
    expect(parseMeshyStatus({ status: "FAILED" }).status).toBe("failed");
  });

  it("不明/空は running（落とさない）かつ glbUrl 無し", () => {
    const r = parseMeshyStatus({});
    expect(r.status).toBe("running");
    expect(r.glbUrl).toBeUndefined();
  });
});

describe("parseSerpImages", () => {
  it("images_results から url/サイズを取り出す", () => {
    const cands = parseSerpImages({
      images_results: [
        { original: "https://a/1.png", original_width: 800, original_height: 600 },
        { thumbnail: "https://a/2.png" },
        { foo: "bar" },
      ],
    });
    expect(cands.length).toBe(2);
    expect(cands[0]).toEqual({ url: "https://a/1.png", width: 800, height: 600 });
    expect(cands[1]!.url).toBe("https://a/2.png");
  });

  it("配列が無ければ空", () => {
    expect(parseSerpImages({})).toEqual([]);
  });
});
