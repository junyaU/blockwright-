import { describe, it, expect } from "vitest";
import { toWorld, transformBuilding, lookFromYaw, planPlacement, type LocalOp } from "./geometry.js";
import type { Vec3 } from "./ir.js";

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };
// toWorld はオフセット無し：origin は footprint 最小角。

describe("toWorld (FR-23)", () => {
  it("north は恒等回転", () => {
    expect(toWorld({ x: 1, y: 2, z: 3 }, "north", ORIGIN, 5, 5)).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("4 facing すべてが proper rotation（最小角アンカー・y 不変）", () => {
    for (const f of ["north", "south", "east", "west"] as const) {
      const corner = toWorld({ x: 4, y: 0, z: 2 }, f, ORIGIN, 5, 3);
      expect(corner.y).toBe(0);
      expect(corner.x).toBeGreaterThanOrEqual(0);
      expect(corner.z).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("transformBuilding: fill の min/max 再計算 (R2)", () => {
  it("90°回転で角が入れ替わっても fill は min<=max に正規化される", () => {
    const ops: LocalOp[] = [{ kind: "fill", min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 0, z: 3 }, material: "minecraft:stone" }];
    const { commands } = transformBuilding(ops, "south", ORIGIN, 3, 4);
    expect(commands).toHaveLength(1);
    // south: (0,0)->(2,3)、(2,3)->(0,0)。min/max 再計算で正規化。
    expect(commands[0]).toBe("fill 0 0 0 2 0 3 minecraft:stone");
  });

  it("point は setblock になり region に反映される", () => {
    const ops: LocalOp[] = [{ kind: "point", pos: { x: 1, y: 5, z: 1 }, material: "minecraft:glass" }];
    const { commands, region } = transformBuilding(ops, "north", ORIGIN, 5, 5);
    expect(commands[0]).toBe("setblock 1 5 1 minecraft:glass");
    expect(region.min).toEqual({ x: 1, y: 5, z: 1 });
  });
});

describe("lookFromYaw (R6・要実機確認の規約)", () => {
  it("yaw を 4 方位へスナップする", () => {
    expect(lookFromYaw(0)).toBe("south");
    expect(lookFromYaw(180)).toBe("north");
    expect(lookFromYaw(90)).toBe("west");
    expect(lookFromYaw(-90)).toBe("east");
  });
});

describe("planPlacement (FR-24)", () => {
  it("ドアはプレイヤーの向きの反対（プレイヤー側）を向き、家は前方に出る", () => {
    const { origin, facing } = planPlacement({ x: 0, y: 64, z: 0 }, 0 /* look south */, 7, 7);
    expect(facing).toBe("north"); // 反対＝ドアがプレイヤー側
    expect(origin.z).toBeGreaterThan(0); // 視線(+Z/south)方向の前方へ
    expect(origin.y).toBe(64);
  });

  it("明示 facing があればそれを尊重する", () => {
    const { facing } = planPlacement({ x: 0, y: 64, z: 0 }, 0, 7, 7, "west");
    expect(facing).toBe("west");
  });
});
