import { describe, it, expect } from "vitest";
import { selectBestImage, slug } from "./image.js";
import type { ImageCandidate } from "./adapters/imageSearch.js";

describe("selectBestImage（関連度順×正方形・サイズ条件／R4）", () => {
  it("先頭の横長を飛ばし、正方形で十分大きい候補を選ぶ", () => {
    const wide: ImageCandidate = { url: "wide", width: 1920, height: 1080 }; // 集合絵/サムネ想定
    const square: ImageCandidate = { url: "square", width: 800, height: 800 };
    expect(selectBestImage([wide, square])!.url).toBe("square");
  });

  it("条件を満たす中では検索関連度の先頭を選ぶ（大小でなく順序）", () => {
    const first: ImageCandidate = { url: "first", width: 512, height: 512 };
    const bigger: ImageCandidate = { url: "bigger", width: 1000, height: 1000 };
    expect(selectBestImage([first, bigger])!.url).toBe("first");
  });

  it("小さすぎるアイコンは飛ばす", () => {
    const tiny: ImageCandidate = { url: "tiny", width: 100, height: 100 };
    const ok: ImageCandidate = { url: "ok", width: 600, height: 600 };
    expect(selectBestImage([tiny, ok])!.url).toBe("ok");
  });

  it("全部横長なら関連度先頭にフォールバック", () => {
    const r2x1: ImageCandidate = { url: "2:1", width: 2000, height: 1000 };
    const r16x9: ImageCandidate = { url: "16:9", width: 1920, height: 1080 };
    expect(selectBestImage([r2x1, r16x9])!.url).toBe("2:1");
  });

  it("空なら null", () => {
    expect(selectBestImage([])).toBeNull();
  });
});

describe("slug", () => {
  it("英数以外を _ に畳む", () => {
    expect(slug("Kirby")).toBe("kirby");
    expect(slug("ドラえもん Doraemon!")).toBe("doraemon");
  });
});
