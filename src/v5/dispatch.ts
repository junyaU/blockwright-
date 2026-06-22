/**
 * §6.5 v5 ディスパッチ＆in-place 更新（FR-77/79/82）。
 *
 * EditOp を経路へ振り分ける。出口は常に GridIR → build()（下流不変）。
 * - 安い修正（recolor/rescale/mirror/rotate）：決定論変形 → in-place 置換。
 * - move：origin だけ変えて in-place（GridIR 不変・§2.2）。
 * - delete：現在対象 region を air 埋め。
 * - regen：作り直し（v4 再生成）。曖昧/形変更は確認してから（pendingConfirm）。
 * - new：cache or v4 生成 → プレイヤー前方へ新規配置。
 *
 * Minecraft I/O・v4 生成は EditContext 経由で注入する（このモジュールは座標/形を作らない）。
 * in-place は「旧領域 Undo → 新 GridIR を build」で統一し、残骸を残さない（R5）。
 */
import { build } from "../build.js";
import { planPlacement, lookFromYaw } from "../geometry.js";
import { airFillCommands, type UndoManager } from "../undo.js";
import { slug } from "../pipeline/image.js";
import { recolor, rescale, mirror, rotate } from "./transform.js";
import type { EditOp, MoveDir } from "./interpret.js";
import type { SessionState } from "./session.js";
import type { GridIR, Vec3, Facing } from "../ir.js";
import { log } from "../log.js";

/** move のデフォルト移動量（ブロック数）。 */
const MOVE_AMOUNT_DEFAULT = 3;

export interface ObtainResult {
  ir: GridIR;
  /** ライブラリ命中（決定論ロード）か新規生成か（FR-71・ログ用）。 */
  fromCache: boolean;
  mode: "3d" | "flat";
}

/** index 側から注入する副作用（Minecraft I/O・v4 生成）。 */
export interface EditContext {
  session: SessionState;
  undo: UndoManager;
  mc: {
    run(cmds: string[]): Promise<void>;
    say(text: string): Promise<void>;
    queryState(): Promise<{ pos: Vec3; yaw: number } | null>;
  };
  /** v4 生成（cache 込み）。null=取得/生成不可。生成前の「生成中…」通知も実装側で行う。 */
  obtain(subject: string, size?: number): Promise<ObtainResult | null>;
}

/** プレイヤー視点の各 facing の前方単位ベクトル（XZ）。 */
const DIR_VEC: Record<Facing, { x: number; z: number }> = {
  north: { x: 0, z: -1 },
  south: { x: 0, z: 1 },
  east: { x: 1, z: 0 },
  west: { x: -1, z: 0 },
};

/** 現在 origin を、プレイヤー視点の相対方向へ amount だけずらす（move 用）。 */
function moveOrigin(origin: Vec3, dir: MoveDir, amount: number, yaw: number): Vec3 {
  const f = DIR_VEC[lookFromYaw(yaw)];
  let dx = 0;
  let dy = 0;
  let dz = 0;
  switch (dir) {
    case "forward": dx = f.x * amount; dz = f.z * amount; break;
    case "back": dx = -f.x * amount; dz = -f.z * amount; break;
    // 右＝前方を時計回りに 90°：(x,z)→(-z,x)。south(0,1)→west(-1,0)。
    case "right": dx = -f.z * amount; dz = f.x * amount; break;
    case "left": dx = f.z * amount; dz = -f.x * amount; break;
    case "up": dy = amount; break;
    case "down": dy = -amount; break;
  }
  return { x: origin.x + dx, y: origin.y + dy, z: origin.z + dz };
}

/**
 * in-place 更新：旧領域を air で消し、新 GridIR を build して現在対象を置き換える（R5）。
 * origin 省略時は現在対象の origin を流用（move のみ新 origin を渡す）。
 */
async function replaceCurrent(
  ctx: EditContext,
  ir: GridIR,
  sayMsg: string,
  opts?: { origin?: Vec3; identity?: { name: string; subject: string } },
): Promise<void> {
  const cur = ctx.session.getCurrent();
  if (!cur) {
    await ctx.mc.say("§e直す対象がありません。");
    return;
  }
  const origin = opts?.origin ?? cur.origin;

  // 1. 旧領域を消す（残骸を残さない）。
  await ctx.mc.run(airFillCommands(cur.region));
  // 2. 新 GridIR を build（GridIR→build・不変）。
  const built = build(ir, origin);
  await ctx.mc.run(built.commands);
  ctx.undo.record(built);
  // 3. 現在対象を更新。
  const identity = opts?.identity ?? { name: cur.name, subject: cur.subject };
  ctx.session.setCurrent({ gridIR: ir, origin, region: built.region, ...identity });
  log.info("in-place 更新", { origin, region: built.region, identity });
  await ctx.mc.say(sayMsg);
}

/** 新規 GridIR をプレイヤー前方へ配置し、現在対象にする（new / cache ロード）。 */
async function placeAsCurrent(ctx: EditContext, got: ObtainResult, subject: string): Promise<void> {
  const state = await ctx.mc.queryState();
  if (!state) {
    await ctx.mc.say("§c座標が取得できませんでした。");
    return;
  }
  const ir = got.ir;
  const { w, d } = ir.size;
  const explicit = ir.facing && ir.facing !== "auto" ? ir.facing : undefined;
  const { origin, facing } = planPlacement(state.pos, state.yaw, w, d, explicit);
  ir.facing = facing;

  if (got.mode === "flat") await ctx.mc.say("§e立体生成に失敗したため、平面で建てます。");

  const built = build(ir, origin);
  await ctx.mc.run(built.commands);
  ctx.undo.record(built);
  ctx.session.setCurrent({ gridIR: ir, origin, region: built.region, name: slug(subject), subject });
  log.info("新規配置", { subject, fromCache: got.fromCache, facing, origin });

  const head = got.fromCache ? "§a（ライブラリから即・無生成で）" : "§a";
  const { h } = ir.size;
  await ctx.mc.say(`${head}「${subject}」を建てました（${w}x${h}x${d} / 正面:${facing}）。「もどして」で取り消し。`);
}

async function handleNew(ctx: EditContext, subject: string, size?: number): Promise<void> {
  const got = await ctx.obtain(subject, size);
  if (!got) {
    await ctx.mc.say(`§c「${subject}」を作れませんでした。`);
    return;
  }
  await placeAsCurrent(ctx, got, subject);
}

async function handleDelete(ctx: EditContext): Promise<void> {
  const cur = ctx.session.getCurrent();
  if (!cur) {
    await ctx.mc.say("§e消せる対象がありません。");
    return;
  }
  await ctx.mc.run(airFillCommands(cur.region));
  ctx.session.clear();
  // undo はそのままでよい：「もどして」しても既に air の領域を再 air 埋めするだけで無害。
  log.info("delete（現在対象を消去）", { region: cur.region });
  await ctx.mc.say("§a現在の対象を消しました。");
}

/**
 * EditOp を経路へ振り分ける。confirmed=true は確認済み（regen を再確認せず実行）。
 */
export async function dispatch(op: EditOp, ctx: EditContext, confirmed = false): Promise<void> {
  log.info("dispatch", { kind: op.kind, confirmed });

  switch (op.kind) {
    case "none":
      await ctx.mc.say("§e修正の意図が読み取れませんでした。");
      return;

    case "new":
      await handleNew(ctx, op.subject, op.size);
      return;

    case "delete":
      await handleDelete(ctx);
      return;

    case "regen": {
      if (!ctx.session.hasCurrent()) {
        await ctx.mc.say("§e作り直す対象がありません。");
        return;
      }
      if (!confirmed) {
        // 形変更＝作り直し（微調整ではない）。確認してから（§6.5 / FR-78）。
        const prompt =
          `§e形の変更は作り直しになります（見た目が変わることがあります）。「${op.modifiedSubject}」で作り直しますか？（はい / いいえ）`;
        ctx.session.setPending({ op, prompt });
        await ctx.mc.say(prompt);
        return;
      }
      // 「生成中…」の通知は obtain 側（実際に生成するときだけ）に任せる。
      const got = await ctx.obtain(op.modifiedSubject);
      if (!got) {
        await ctx.mc.say("§c作り直しに失敗しました。");
        return;
      }
      await replaceCurrent(ctx, got.ir, `§a作り直しました${got.mode === "flat" ? "（平面）" : ""}。`, {
        identity: { name: slug(op.modifiedSubject), subject: op.modifiedSubject },
      });
      return;
    }

    // ── 以降は安い修正（現在対象が必須）──
    case "recolor":
    case "rescale":
    case "mirror":
    case "rotate":
    case "move": {
      const cur = ctx.session.getCurrent();
      if (!cur) {
        await ctx.mc.say("§e直す対象がありません。先に何か建ててください。");
        return;
      }
      switch (op.kind) {
        case "recolor":
          await replaceCurrent(ctx, recolor(cur.gridIR, op.mapping), "§a色を変えました。");
          return;
        case "rescale":
          await replaceCurrent(ctx, rescale(cur.gridIR, op.targetSize), `§a大きさを変えました（最長辺${op.targetSize}）。`);
          return;
        case "mirror":
          await replaceCurrent(ctx, mirror(cur.gridIR, op.axis), `§a反転しました（${op.axis}軸）。`);
          return;
        case "rotate":
          await replaceCurrent(ctx, rotate(cur.gridIR, op.quarterTurns), `§a回転しました（90°×${op.quarterTurns}）。`);
          return;
        case "move": {
          const state = await ctx.mc.queryState();
          const yaw = state?.yaw ?? 0;
          const amount = op.placement.amount ?? MOVE_AMOUNT_DEFAULT;
          const newOrigin = moveOrigin(cur.origin, op.placement.dir, amount, yaw);
          await replaceCurrent(ctx, cur.gridIR, `§a移動しました（${op.placement.dir} ${amount}）。`, { origin: newOrigin });
          return;
        }
      }
    }
  }
}
