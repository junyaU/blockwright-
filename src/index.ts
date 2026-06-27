/**
 * 配線（C1〜C4 の結線）。発言 → トリガー判定 → IR 生成 → build → 送信 → Undo 登録。
 *
 * 設計の背骨は IR seam（build）。ここはオーケストレーションだけを担い、
 * 座標計算・素材解決などの正確さは下流（決定論的なコード）に委ねる。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MinecraftServer, type PlayerMessageBody } from "./server.js";
import { generateIR } from "./claude.js";
import { build } from "./build.js";
import { parseIR } from "./ir.js";
import { planPlacement } from "./geometry.js";
import { UndoManager } from "./undo.js";
import { config, pipelineEnabled } from "./config.js";
import { log, time } from "./log.js";
import { voxelizeFile } from "./voxelize/index.js";
import { resolveCharacterGrid } from "./pipeline/orchestrate.js";
import { slug } from "./pipeline/image.js";
import { SessionState } from "./v5/session.js";
import { Library } from "./v5/library.js";
import { interpret, type EditOp } from "./v5/interpret.js";
import { dispatch, placeAsCurrent, type EditContext, type ObtainResult } from "./v5/dispatch.js";
// v6：経路ルーター＋リファレンス識別（新規建築の生成元選択。v5 の編集/キャッシュ/削除は不変・FR-94）。
import { classify, type Classification } from "./v6/classify.js";
import { decideRoute, type RoutePolicy } from "./v6/route.js";
import { identifyReference } from "./v6/reference.js";
import { handleUnidentified } from "./v6/policy.js";
import type { BoxIR, HouseIR, TowerIR, WallIR, BridgeIR, GridIR, Facing, Vec3 } from "./ir.js";

const server = new MinecraftServer();
const undo = new UndoManager();
// v5：現在対象（修正の参照先・FR-72）とライブラリ（GridIR キャッシュ・FR-70/71）。
const session = new SessionState();
const library = new Library(config.libraryDir);

function includesAny(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

/**
 * v5：subject → GridIR（ライブラリ命中なら決定論ロード、無ければ v4 生成して保存）。
 * 2 回目以降は生成を呼ばず即・無生成で建つ（FR-71）。new / regen 経路が共用する。
 */
async function obtain(subject: string, size?: number, refImagePath?: string): Promise<ObtainResult | null> {
  // ライブラリは「既定サイズ」のアセットだけを貯める。サイズ明示時はキャッシュを使わず
  // その場限りで生成（小さい/大きい指定が既定キャッシュを汚さない・上書きしない）。
  const useCache = size === undefined;
  const cachedName = useCache ? library.find(subject) : null;
  if (cachedName) {
    const ir = library.load(cachedName);
    if (ir) {
      log.info("ライブラリ命中：生成スキップ", { subject, name: cachedName });
      return { ir, fromCache: true, mode: "3d" };
    }
  }
  if (!pipelineEnabled()) {
    log.warn("生成不可（v4 無効・ライブラリ未命中）", { subject });
    return null;
  }
  // 生成中の通知は「実際に生成するとき」だけ（cache 命中時は即時なので出さない）。
  await server.say(`§7「${subject}」を生成中…（少し時間がかかります）`);
  // v6：refImagePath があれば識別済み参照で生成（acquireImage をスキップ）。無ければ従来どおり。
  const res = await resolveCharacterGrid(subject, size, refImagePath);
  if (!res.ok) {
    log.warn("v4 生成に失敗", { subject, error: res.error });
    return null;
  }
  // 安全網：生成/フォールバック出力も parseIR で再検証してから採用する。
  const parsed = parseIR(res.ir);
  if (!parsed.ok || parsed.ir.type !== "grid") {
    log.warn("生成結果が不正", { subject, reason: parsed.ok ? "型不一致" : parsed.error });
    return null;
  }
  if (useCache) library.maybeSave(subject, parsed.ir); // 既定サイズの初回だけ貯める（2 回目以降は決定論ロード）
  return { ir: parsed.ir, fromCache: false, mode: res.mode };
}

/** v5：dispatch に渡す副作用（Minecraft I/O・v4 生成）。座標/形はここで作らない。 */
const editCtx: EditContext = {
  session,
  undo,
  mc: {
    run: (cmds) => server.runCommands(cmds).then(() => undefined),
    say: (text) => server.say(text),
    queryState: () => server.queryPlayerState(),
  },
  obtain,
};

/** facing を持つ建物 IR（box は前方配置・回転をしないので除く）。 */
type PlaceableIR = HouseIR | TowerIR | WallIR | BridgeIR | GridIR;

/**
 * プレイヤー前方へ配置して建て、Undo 登録し、結果をチャット通知する共通フロー。
 * house/tower/wall/bridge/grid は「footprint 寸法」と「完了メッセージ」だけが異なるので
 * その 2 点をパラメータ化して 1 本に畳む（IR seam・送信・Undo はノータッチ）。
 * v5：現在対象の更新に origin/region が要るので build 結果を返す（呼び出し側は無視可）。
 */
async function buildAndPlace(
  ir: PlaceableIR,
  player: Vec3,
  yaw: number,
  dims: { w: number; d: number },
  sayDone: (facing: Facing) => string,
): Promise<{ origin: Vec3; facing: Facing; built: ReturnType<typeof build> }> {
  const explicit = ir.facing && ir.facing !== "auto" ? ir.facing : undefined;
  const { origin, facing } = planPlacement(player, yaw, dims.w, dims.d, explicit);
  ir.facing = facing;
  log.info("配置/facing 解決", { yaw, facing, origin });

  const built = build(ir, origin);
  log.info("送信コマンド数", built.commands.length);
  await time("runCommands", () => server.runCommands(built.commands), { count: built.commands.length });
  undo.record(built);

  await server.say(sayDone(facing));
  return { origin, facing, built };
}

// v6：曖昧/低信頼の経路ポリシー（config から組み立て・decideRoute を純粋に保つため引数で渡す）。
const routePolicy: RoutePolicy = {
  ambiguity: config.v6AmbiguityPolicy,
  confidenceThreshold: config.v6ClassifyConfidence,
};

/**
 * v6 経路ルーター（新規建築の生成元選択・付録A）。
 * 戻り値 true=ここで処理完了 / false=パラメトリックへ委譲（呼び出し側が generateIR→buildXFlow）。
 * 分類 → キャッシュ最優先 → 経路決定 → generation / confirm を捌く。★形には触れない（分類と vision 判定のみ）。
 */
async function routeNewBuild(utterance: string): Promise<boolean> {
  const c = await time("classify", () => classify(utterance)); // ①固有/ジェネリック/曖昧（AI 言語）
  log.info("v6 分類", {
    category: c.category,
    subject: c.subject,
    styleHint: c.styleHint,
    size: c.size,
    confidence: c.confidence,
  });

  // 分類不能（空 subject＝壊れ出力）はパラメトリックに委譲（発話のトリガー語を活かす）。
  if (c.subject === "") return false;

  // ②キャッシュ最優先（FR-92・AC-59）：既定サイズの既知 subject は決定論ロードで即建て。
  // size 明示時は obtain と同じくキャッシュを使わない（既定アセットを汚さない）。
  if (c.size === undefined && library.find(c.subject)) {
    await dispatch({ kind: "new", subject: c.subject }, editCtx);
    return true;
  }

  const decision = decideRoute(c, routePolicy); // ③決定論ディスパッチ
  log.info("v6 経路決定", { decision, subject: c.subject });

  if (decision.route === "parametric") return false; // 既存 generateIR→buildXFlow へ委譲

  if (decision.route === "confirm") {
    // 曖昧確認モード（§6.4）。v5 の はい/いいえ 保留フローをそのまま再利用する（v5 機構は不変）。
    const op: EditOp = { kind: "new", subject: c.subject, ...(c.size !== undefined ? { size: c.size } : {}) };
    const prompt = `§e「${c.subject}」を特定のものとして作りますか？（はい / いいえ）`;
    session.setPending({ op, prompt });
    await server.say(prompt);
    return true;
  }

  await runGeneration(c, decision.strict); // generation
  return true;
}

/**
 * generation 経路。strict（固有/曖昧寄り）は vision リファレンス識別、
 * strict:false（型なし汎用）は従来の acquireImage 経路（精度不要・vision 省略）。
 */
async function runGeneration(c: Classification, strict: boolean): Promise<void> {
  if (!strict) {
    // ジェネリック無型（城・教会等）→ 汎用生成（FR-87・AC-58）。既存 new 経路に委ねる。
    await dispatch(
      { kind: "new", subject: c.subject, ...(c.size !== undefined ? { size: c.size } : {}) },
      editCtx,
    );
    return;
  }

  // 固有：正規化→候補→vision検証→最良1枚（FR-86/88/89・AC-53/55）。
  // 検索＋vision は数秒かかるので、無言の間を作らない（原則10）。
  await server.say(`§7「${c.subject}」の参照画像を探しています…`);
  const ref = await time("identifyReference", () => identifyReference(c.subject, { strict: true }));
  if (!ref || !ref.confident) {
    // 同定不能：無言で建てず通知/平面（§6.5・FR-90・AC-56）。
    await handleUnidentified(ref?.path ?? null, {
      policy: config.v6UnidentifiedPolicy,
      subject: c.subject,
      say: (t) => server.say(t),
      buildFromImage: async (path) => {
        const got = await obtain(c.subject, c.size, path);
        if (!got) return false;
        await placeAsCurrent(editCtx, got, c.subject);
        return true;
      },
    });
    return;
  }

  // 識別済み参照で v4 生成（ライブラリ保存は obtain が担う＝2 回目はキャッシュ・FR-92）。
  const got = await obtain(c.subject, c.size, ref.path);
  if (!got) {
    await server.say(`§c「${c.subject}」を作れませんでした。`);
    return;
  }
  await placeAsCurrent(editCtx, got, c.subject);
}

async function handleBuild(utterance: string): Promise<void> {
  // v6：外部キーが設定済みなら経路ルーターで振り分ける（①分類→②キャッシュ→③経路）。
  // 未設定なら v6/v4 をスキップし、余分な Claude 呼び出しもせず従来パラメトリックのみ（§配線）。
  if (pipelineEnabled()) {
    const handled = await routeNewBuild(utterance);
    if (handled) return; // generation / confirm / cache / 同定不能 はここで完了。
    // parametric（型あり/分類不能）だけが下のパラメトリック経路へフォールスルーする。
  }

  const state = await server.queryPlayerState();
  if (!state) {
    await server.say("§c座標が取得できませんでした。");
    return;
  }

  const result = await time("generateIR", () => generateIR(utterance));
  if (!result.ok) {
    await server.say(`§c建築に失敗しました: ${result.error}`);
    return;
  }
  if (result.warnings.length > 0) log.warn("IR 警告", result.warnings);
  log.info("生成 IR", result.ir);

  if (result.ir.type === "house") {
    await buildHouseFlow(result.ir, state.pos, state.yaw);
  } else if (result.ir.type === "tower") {
    await buildTowerFlow(result.ir, state.pos, state.yaw);
  } else if (result.ir.type === "wall") {
    await buildWallFlow(result.ir, state.pos, state.yaw);
  } else if (result.ir.type === "bridge") {
    await buildBridgeFlow(result.ir, state.pos, state.yaw);
  } else if (result.ir.type === "box") {
    await buildBoxFlow(result.ir, state.pos);
  } else {
    // grid は LLM 経路（プロンプト）に無いので、ここには来ない想定。
    // 万一来ても防御的に拒否する（grid は !grid 開発コマンド経由のみ・R1）。
    await server.say("§cその形式には対応していません。");
  }
}

/** box：AI 素材を信頼して建て、最初の fill が失敗したらフォールバックで建て直す（v0 方式）。 */
async function buildBoxFlow(ir: BoxIR, origin: { x: number; y: number; z: number }): Promise<void> {
  const { w, d, h } = ir.size;
  let built = build(ir, origin);
  log.info("送信コマンド", built.commands);
  const first = built.commands[0];
  const firstBody = first ? await server.runCommand(first) : { statusCode: 0 };

  if (firstBody?.statusCode !== 0) {
    log.warn("素材が無効の可能性。フォールバックで建て直します。", { material: ir.material, body: firstBody });
    built = build({ ...ir, material: config.fallbackMaterial }, origin);
    for (const cmd of built.commands) await server.runCommand(cmd);
    undo.record(built);
    await server.say(
      `§e「${ir.material}」は使えなかったので ${config.fallbackMaterial} で建てました（${w}x${d}x${h}）。取り消すには「もどして」。`,
    );
    return;
  }

  for (const cmd of built.commands.slice(1)) {
    const body = await server.runCommand(cmd);
    if (body?.statusCode !== 0) log.warn("コマンドが失敗を返しました", { cmd, body });
  }
  undo.record(built);
  await server.say(`§a完成しました（${w}x${d}x${h} / ${ir.material}）。取り消すには「もどして」。`);
}

/** house：プレイヤー前方に配置し、ドアがプレイヤー側を向く向きで決定論生成して送る。 */
async function buildHouseFlow(ir: HouseIR, player: Vec3, yaw: number): Promise<void> {
  const { w, d } = ir.footprint;
  await buildAndPlace(ir, player, yaw, { w, d }, (facing) =>
    `§a家を建てました（${w}x${d} / ${ir.roof}屋根 / 正面:${facing}）。取り消すには「もどして」。`,
  );
}

/** tower：house と同様に前方配置・ドアがプレイヤー側を向く向きで決定論生成して送る。 */
async function buildTowerFlow(ir: TowerIR, player: Vec3, yaw: number): Promise<void> {
  const { w, d } = ir.footprint;
  await buildAndPlace(ir, player, yaw, { w, d }, (facing) =>
    `§a塔を建てました（${w}x${d} / 高さ${ir.height} / ${ir.cap ?? "battlement"} / 正面:${facing}）。取り消すには「もどして」。`,
  );
}

/** wall：プレイヤー前方に配置し、正面(lz=0)がプレイヤー側を向く向きで生成して送る。 */
async function buildWallFlow(ir: WallIR, player: Vec3, yaw: number): Promise<void> {
  await buildAndPlace(ir, player, yaw, { w: ir.length, d: ir.thickness ?? 1 }, (facing) =>
    `§a防壁を建てました（長さ${ir.length} / 高さ${ir.height} / 正面:${facing}）。取り消すには「もどして」。`,
  );
}

/** bridge：プレイヤー前方に配置し、正面(lz=0)がプレイヤー側を向く向きで生成して送る。 */
async function buildBridgeFlow(ir: BridgeIR, player: Vec3, yaw: number): Promise<void> {
  await buildAndPlace(ir, player, yaw, { w: ir.span, d: ir.width }, (facing) =>
    `§a橋を架けました（長さ${ir.span} / 幅${ir.width} / 正面:${facing}）。取り消すには「もどして」。`,
  );
}

/**
 * grid 注入経路（開発/テスト用・§v2.x §7.2）。★LLM を通さない★。
 * `fixtures/grid/<name>.json` を読んで GridIR として build に渡す。
 * AI に grid を埋めさせないため、通常の発言→Claude 経路とは完全に分離する（R1）。
 */
async function handleGrid(name: string): Promise<void> {
  if (!/^[a-z0-9_-]+$/.test(name)) {
    await server.say("§e使い方：!grid <name>（例 !grid stairs）。name は英数字・_・- のみ。");
    return;
  }

  let raw: unknown;
  try {
    const text = readFileSync(join(process.cwd(), "fixtures", "grid", `${name}.json`), "utf8");
    raw = JSON.parse(text);
  } catch (e) {
    log.warn("grid フィクスチャ読込失敗", { name, error: String(e) });
    await server.say(`§cフィクスチャ「${name}」を読み込めませんでした。`);
    return;
  }

  const parsed = parseIR(raw);
  if (!parsed.ok) {
    await server.say(`§cgrid の検証に失敗: ${parsed.error}`);
    return;
  }
  if (parsed.ir.type !== "grid") {
    await server.say("§cこのフィクスチャは grid 型ではありません。");
    return;
  }
  if (parsed.warnings.length > 0) log.warn("grid 警告", parsed.warnings);

  await placeAndBuildGrid(parsed.ir, name);
}

/**
 * GridIR をプレイヤー前方に配置して建て、Undo 登録する共通処理（!grid / !voxelize で共用）。
 * grid（v2.x）と voxelize（v3）はどちらも GridIR を出口とするため、下流の配線は同一。
 */
async function placeAndBuildGrid(ir: GridIR, label: string): Promise<void> {
  const state = await server.queryPlayerState();
  if (!state) {
    await server.say("§c座標が取得できませんでした。");
    return;
  }

  const { w, h, d } = ir.size;
  const { origin, built } = await buildAndPlace(ir, state.pos, state.yaw, { w, d }, (facing) =>
    `§a「${label}」を設置しました（${w}x${h}x${d} / 正面:${facing}）。取り消すには「もどして」。`,
  );

  // v5：GridIR は修正の対象になりうるので現在対象として保持する（!grid / !voxelize / 生成 すべて）。
  session.setCurrent({ gridIR: ir, origin, region: built.region, name: slug(label), subject: label });
}

/**
 * v3 ボクセル化注入経路（開発用・§v3 §3）。★LLM を通さない★。
 * `assets/<file>` の画像/3Dモデルを GridIR にボクセル化して build に渡す。
 * 形（占有）は決定論コードが決め、AI は一切関与しない（R1）。
 * 例：!voxelize sample.png 16 / !voxelize model.glb 20 solid
 */
async function handleVoxelize(argline: string): Promise<void> {
  const args = argline.trim().split(/\s+/).filter(Boolean);
  const file = args[0];
  if (!file || !/^[a-z0-9_.-]+$/i.test(file)) {
    await server.say("§e使い方：!voxelize <file> <size> [thickness|fill]（例 !voxelize sample.png 16）。");
    return;
  }
  const size = args[1] !== undefined ? Number(args[1]) : undefined;
  const third = args[2];
  const thickness = third !== undefined && /^\d+$/.test(third) ? Number(third) : undefined;
  const fill = third === "shell" || third === "solid" ? third : undefined;

  let ir: GridIR;
  try {
    const gridIr = await voxelizeFile(join(process.cwd(), "assets", file), {
      size: size !== undefined && Number.isFinite(size) ? size : undefined,
      thickness,
      fill,
    });
    // 安全網：ボクセル化出力も parseIR で再検証してから建てる。
    const parsed = parseIR(gridIr);
    if (!parsed.ok || parsed.ir.type !== "grid") {
      await server.say(`§cボクセル化結果が不正です: ${parsed.ok ? "型不一致" : parsed.error}`);
      return;
    }
    if (parsed.warnings.length > 0) log.warn("voxelize 警告", parsed.warnings);
    ir = parsed.ir;
  } catch (e) {
    log.warn("ボクセル化失敗", { file, error: String(e) });
    await server.say(`§c「${file}」のボクセル化に失敗しました。assets/ にファイルがありますか？`);
    return;
  }

  await placeAndBuildGrid(ir, file);
}

/**
 * v5：フォローアップ修正発話の解釈と実行（明示トリガー＝editWords 起動）。
 * 現在対象のメタ（size・palette・voxel は渡さない）から EditOp を分類し、ディスパッチする。
 * 曖昧/形変更は dispatch 側が確認保留（pendingConfirm）にする（§6.5 / FR-81）。
 */
async function handleEdit(utterance: string): Promise<void> {
  const meta = session.currentMeta();
  if (!meta) {
    await server.say("§e直す対象がありません。先に何か建ててください。");
    return;
  }
  const op = await interpret(utterance, meta);
  await dispatch(op, editCtx);
}

async function handleUndo(): Promise<void> {
  const cmds = undo.buildUndoCommands();
  if (!cmds) {
    await server.say("§e取り消せる建築がありません。");
    return;
  }
  log.info("Undo コマンド数", cmds.length);
  await server.runCommands(cmds);
  await server.say("§a直前の建築を取り消しました。");
}

function onMessage(body: PlayerMessageBody): void {
  // 自分の say 等に反応しないよう、プレイヤーのチャットのみ扱う。
  if (body.type !== "chat" || !body.sender) return;

  const text = body.message ?? "";
  log.info("PlayerMessage", { sender: body.sender, message: text });

  // grid 注入（開発コマンド）。LLM を通さず fixtures から直接（§v2.x §7.2 / R1）。
  if (text.startsWith("!grid")) {
    const name = text.slice("!grid".length).trim();
    handleGrid(name).catch((e) => log.error("grid 処理で例外", String(e)));
    return;
  }

  // v3 ボクセル化（開発コマンド）。LLM を通さず assets のリファレンスから直接（§v3 §3 / R1）。
  if (text.startsWith("!voxelize")) {
    const argline = text.slice("!voxelize".length);
    handleVoxelize(argline).catch((e) => log.error("voxelize 処理で例外", String(e)));
    return;
  }

  // v5：確認保留中（曖昧/作り直し）なら、はい/いいえ を先に処理する（§6.5）。
  const pending = session.getPending();
  if (pending) {
    if (includesAny(text, config.confirmYesWords)) {
      session.clearPending();
      dispatch(pending.op, editCtx, true).catch((e) => log.error("確認実行で例外", String(e)));
      return;
    }
    if (includesAny(text, config.confirmNoWords)) {
      session.clearPending();
      server.say("§7作り直しをやめました。").catch((e) => log.error("say で例外", String(e)));
      return;
    }
    // どちらでもなければ保留を破棄し、通常処理へフォールスルー（新しい指示を優先）。
    session.clearPending();
  }

  // 失敗してもプロセスを落とさない（§8）。各ハンドラ内で例外は握りつぶしてチャット通知。
  if (includesAny(text, config.undoWords)) {
    handleUndo().catch((e) => log.error("Undo 処理で例外", String(e)));
    return;
  }
  // v5：修正の明示トリガー（editWords）。現在対象への修正発話を解釈・実行する。
  if (includesAny(text, config.editWords)) {
    handleEdit(text).catch((e) => log.error("修正処理で例外", String(e)));
    return;
  }
  if (includesAny(text, config.triggerWords)) {
    handleBuild(text).catch((e) => log.error("建築処理で例外", String(e)));
  }
}

// プロセス全体を単一の失敗で落とさない（§8）。
process.on("uncaughtException", (e) => log.error("uncaughtException", String(e)));
process.on("unhandledRejection", (e) => log.error("unhandledRejection", String(e)));

server.onPlayerMessage(onMessage);
server.start();
log.info(
  `準備完了。トリガー語=${JSON.stringify(config.triggerWords)} / Undo語=${JSON.stringify(config.undoWords)}`,
);
