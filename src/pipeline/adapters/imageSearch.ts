/**
 * ② 画像取得アダプタ（外部・差し替え可能）。既定実装は SerpAPI（google_images）。
 * 別プロバイダ（Google CSE / Bing 等）を足すときは ImageSearchAdapter を実装するだけ。
 * パース（parseSerpImages）は純粋関数でテスト対象、fetch 部は env キー必須。
 */

export interface ImageCandidate {
  url: string;
  width?: number;
  height?: number;
}

export interface ImageSearchAdapter {
  search(query: string): Promise<ImageCandidate[]>;
}

/** SerpAPI の images_results JSON → 候補配列（純粋）。 */
export function parseSerpImages(json: unknown): ImageCandidate[] {
  const results = (json as { images_results?: unknown })?.images_results;
  if (!Array.isArray(results)) return [];
  const out: ImageCandidate[] = [];
  for (const r of results) {
    const o = r as Record<string, unknown>;
    const url = typeof o.original === "string" ? o.original : typeof o.thumbnail === "string" ? o.thumbnail : undefined;
    if (!url) continue;
    out.push({
      url,
      width: typeof o.original_width === "number" ? o.original_width : undefined,
      height: typeof o.original_height === "number" ? o.original_height : undefined,
    });
  }
  return out;
}

/** SerpAPI 実装を作る（apiKey 必須）。 */
export function makeSerpApiSearch(apiKey: string): ImageSearchAdapter {
  return {
    async search(query: string): Promise<ImageCandidate[]> {
      const u = new URL("https://serpapi.com/search.json");
      u.searchParams.set("engine", "google_images");
      u.searchParams.set("q", query);
      u.searchParams.set("api_key", apiKey);
      const resp = await fetch(u);
      if (!resp.ok) throw new Error(`SerpAPI が ${resp.status} を返しました`);
      return parseSerpImages(await resp.json());
    },
  };
}
