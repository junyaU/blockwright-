import { describe, it, expect } from "vitest";
import { srgbToLab, deltaE } from "./color.js";

describe("srgbToLab", () => {
  it("白は L≈100, a≈0, b≈0", () => {
    const [L, a, b] = srgbToLab(255, 255, 255);
    expect(L).toBeCloseTo(100, 1);
    expect(a).toBeCloseTo(0, 1);
    expect(b).toBeCloseTo(0, 1);
  });

  it("黒は L≈0", () => {
    const [L] = srgbToLab(0, 0, 0);
    expect(L).toBeCloseTo(0, 1);
  });

  it("赤は a が正に大きく出る", () => {
    const [, a, b] = srgbToLab(255, 0, 0);
    expect(a).toBeGreaterThan(50);
    expect(b).toBeGreaterThan(30);
  });
});

describe("deltaE", () => {
  it("同色は 0", () => {
    expect(deltaE(srgbToLab(120, 80, 200), srgbToLab(120, 80, 200))).toBe(0);
  });

  it("近い色は遠い色より小さい", () => {
    const base = srgbToLab(200, 50, 50);
    const near = deltaE(base, srgbToLab(205, 55, 48));
    const far = deltaE(base, srgbToLab(50, 50, 200));
    expect(near).toBeLessThan(far);
  });
});
