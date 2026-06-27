/**
 * §6.2 v6 ②経路振り分け（決定論・FR-85/86/87）。
 *
 * 分類結果（Classification）から「どの生成元が IR を用意するか」を決める。
 * - generic で対応する型がある → parametric（v1/v2・生成を呼ばない）
 * - generic で対応型なし（城・教会等）→ generation（汎用生成・vision 不要）
 * - specific → generation（リファレンス識別つき・strict）
 * - ambiguous / 低信頼 → policy（既定は生成寄り・§6.4）
 *
 * ★決定論のみ。AI は呼ばない。出口は index 側で build(ir, origin) に収束する（seam 不変）。
 * ★非対称性の砦（§2.2）：resolveParametricType は generic 枝でのみ参照する。
 *   よって「東京タワー」（specific）は『タワー』の語を含んでも parametric に落ちない。
 *
 * 名前は v5 の dispatch.ts（EditOp ディスパッチ）と衝突させないため route.ts とする。
 */
import type { Classification } from "./classify.js";

/** パラメトリックで作れる型（box は build.ts 内、他は builders）。grid は生成専用なので含めない。 */
export type ParametricType = "box" | "house" | "tower" | "wall" | "bridge";

/** decideRoute の判断材料（config から index 側が組み立てて渡す・純粋に保つ）。 */
export interface RoutePolicy {
  /** 曖昧/低信頼の既定挙動。"generation"=生成寄り（§2.2）/"confirm"=1問確認。 */
  ambiguity: "generation" | "confirm";
  /** これ未満の confidence は曖昧扱い（§6.4 / FR-96）。 */
  confidenceThreshold: number;
}

export type RouteDecision =
  | { route: "parametric"; type: ParametricType }
  | { route: "generation"; strict: boolean }
  | { route: "confirm" };

/** 型ごとの代表語（漢字・かな・カタカナ・英語）。順序は優先度（先に一致した型を採る）。 */
const TYPE_KEYWORDS: ReadonlyArray<readonly [ParametricType, readonly string[]]> = [
  // bridge を house/wall より先に（「歩道橋」等の取り違え回避）。
  ["bridge", ["橋", "はし", "ばし", "桟橋", "歩道橋", "bridge", "ブリッジ"]],
  ["tower", ["塔", "タワー", "櫓", "やぐら", "灯台", "tower"]],
  ["wall", ["壁", "かべ", "塀", "へい", "柵", "さく", "城壁", "防壁", "wall", "ウォール", "フェンス", "fence"]],
  ["house", ["家", "いえ", "家屋", "小屋", "こや", "コテージ", "ハウス", "house", "home", "hut", "cabin", "cottage"]],
  ["box", ["箱", "はこ", "ボックス", "立方体", "キューブ", "box", "cube", "block"]],
];

/**
 * subject（または発話）に対応するパラメトリック型を返す（無ければ null）。
 * ★generic 枝でのみ呼ぶこと（specific を parametric に落とさないため・§2.2）。
 */
export function resolveParametricType(subject: string): ParametricType | null {
  const s = subject.toLowerCase();
  for (const [type, words] of TYPE_KEYWORDS) {
    for (const w of words) {
      if (s.includes(w.toLowerCase())) return type;
    }
  }
  return null;
}

/**
 * 分類 → 経路（決定論）。
 * 誤分類の非対称性（§2.2）に従い、曖昧/低信頼は既定で生成寄り（strict）に倒す。
 */
export function decideRoute(c: Classification, policy: RoutePolicy): RouteDecision {
  // 低信頼は曖昧として扱う（§6.4）。
  const ambiguous = c.category === "ambiguous" || c.confidence < policy.confidenceThreshold;

  if (ambiguous) {
    if (policy.ambiguity === "confirm") return { route: "confirm" };
    // 生成寄り（固有を箱に潰すより、生成して多様な結果を返す方が本丸と整合・§2.2）。
    return { route: "generation", strict: true };
  }

  if (c.category === "specific") {
    return { route: "generation", strict: true };
  }

  // generic：対応する型があれば parametric、無ければ汎用生成（vision 不要＝strict:false）。
  const type = resolveParametricType(c.subject);
  if (type) return { route: "parametric", type };
  return { route: "generation", strict: false };
}
