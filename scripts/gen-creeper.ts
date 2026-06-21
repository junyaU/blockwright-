/**
 * v3.0 デモ用の 8×8 クリーパー顔 PNG を生成する一回限りのスクリプト。
 * 実行：npx tsx scripts/gen-creeper.ts  → assets/creeper.png
 */
import { Jimp, rgbaToInt } from "jimp";

const G: [number, number, number] = [78, 170, 52]; // 緑（体）
const K: [number, number, number] = [20, 20, 20]; // 黒（顔）

// 8×8 クリーパー顔。1 = 黒、0 = 緑。
const FACE = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 1, 1, 0, 0, 1, 1, 0],
  [0, 1, 1, 0, 0, 1, 1, 0],
  [0, 0, 0, 1, 1, 0, 0, 0],
  [0, 0, 1, 1, 1, 1, 0, 0],
  [0, 0, 1, 1, 1, 1, 0, 0],
  [0, 0, 1, 0, 0, 1, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
];

const img = new Jimp({ width: 8, height: 8 });
for (let y = 0; y < 8; y++) {
  for (let x = 0; x < 8; x++) {
    const [r, g, b] = FACE[y]![x] === 1 ? K : G;
    img.setPixelColor(rgbaToInt(r, g, b, 255), x, y);
  }
}
await img.write("assets/creeper.png");
console.log("wrote assets/creeper.png (8x8)");
