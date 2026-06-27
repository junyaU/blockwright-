import { describe, it, expect } from "vitest";
import { resolveParametricType, decideRoute, type RoutePolicy } from "./route.js";
import type { Classification } from "./classify.js";

const POLICY: RoutePolicy = { ambiguity: "generation", confidenceThreshold: 0.6 };

function cls(over: Partial<Classification>): Classification {
  return { category: "generic", subject: "x", confidence: 1, ...over };
}

describe("resolveParametricType (FR-85/87)", () => {
  it("型語を対応型へ写す", () => {
    expect(resolveParametricType("塔")).toBe("tower");
    expect(resolveParametricType("タワー")).toBe("tower");
    expect(resolveParametricType("家")).toBe("house");
    expect(resolveParametricType("小屋")).toBe("house");
    expect(resolveParametricType("壁")).toBe("wall");
    expect(resolveParametricType("橋")).toBe("bridge");
    expect(resolveParametricType("箱")).toBe("box");
    expect(resolveParametricType("european house")).toBe("house");
  });

  it("対応型の無い一般名は null（→汎用生成）", () => {
    expect(resolveParametricType("城")).toBeNull();
    expect(resolveParametricType("教会")).toBeNull();
    expect(resolveParametricType("castle")).toBeNull();
  });
});

describe("decideRoute (FR-85/86/87)", () => {
  it("generic で型あり → parametric（生成を呼ばない・AC-54）", () => {
    expect(decideRoute(cls({ category: "generic", subject: "塔" }), POLICY)).toEqual({
      route: "parametric",
      type: "tower",
    });
    expect(decideRoute(cls({ category: "generic", subject: "european house" }), POLICY)).toEqual({
      route: "parametric",
      type: "house",
    });
  });

  it("generic で型なし → generation(strict:false)（汎用生成・AC-58）", () => {
    expect(decideRoute(cls({ category: "generic", subject: "castle" }), POLICY)).toEqual({
      route: "generation",
      strict: false,
    });
  });

  it("specific → 常に generation(strict:true)（AC-53/55）", () => {
    expect(decideRoute(cls({ category: "specific", subject: "Tokyo Tower" }), POLICY)).toEqual({
      route: "generation",
      strict: true,
    });
  });

  it("§2.2 非対称性：specific は『タワー』を含んでも parametric に落ちない", () => {
    // 東京タワー（specific）は resolveParametricType('東京タワー')='tower' でも generation。
    expect(resolveParametricType("東京タワー")).toBe("tower"); // 語としては一致するが…
    expect(decideRoute(cls({ category: "specific", subject: "東京タワー" }), POLICY)).toEqual({
      route: "generation",
      strict: true,
    });
  });

  it("ambiguous → 既定（生成寄り）は generation(strict:true)", () => {
    expect(decideRoute(cls({ category: "ambiguous", subject: "お城" }), POLICY)).toEqual({
      route: "generation",
      strict: true,
    });
  });

  it("低信頼（confidence<閾値）は曖昧扱い＝生成寄り", () => {
    expect(decideRoute(cls({ category: "generic", subject: "塔", confidence: 0.3 }), POLICY)).toEqual({
      route: "generation",
      strict: true,
    });
  });

  it("confirm ポリシー時は曖昧→confirm", () => {
    const p: RoutePolicy = { ambiguity: "confirm", confidenceThreshold: 0.6 };
    expect(decideRoute(cls({ category: "ambiguous", subject: "お城" }), p)).toEqual({ route: "confirm" });
    // 低信頼も confirm。
    expect(decideRoute(cls({ category: "specific", subject: "X", confidence: 0.1 }), p)).toEqual({
      route: "confirm",
    });
  });

  it("confirm ポリシーでも高信頼の specific/generic は通常経路", () => {
    const p: RoutePolicy = { ambiguity: "confirm", confidenceThreshold: 0.6 };
    expect(decideRoute(cls({ category: "specific", subject: "Tokyo Tower" }), p)).toEqual({
      route: "generation",
      strict: true,
    });
    expect(decideRoute(cls({ category: "generic", subject: "塔" }), p)).toEqual({
      route: "parametric",
      type: "tower",
    });
  });
});
