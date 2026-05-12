/**
 * Crop a tall mobile-page screenshot down to an "above-the-fold" tile suitable
 * for the README. Usage:
 *
 *   pnpm tsx scripts/crop-readme-screenshot.ts <input.png> <output.png> [maxHeightPx]
 *
 * The input is assumed to come from the cursor-ide-browser screenshot tool,
 * which captures the full page at the device pixel ratio (so the natural width
 * is the viewport width × DPR). We crop the top `maxHeightPx` pixels (default
 * 1600 = roughly 854 logical pixels at 1.875× DPR — i.e. one mobile screen)
 * and resize the result down to a maximum width of 760 px so the README PNGs
 * stay small while still looking sharp on retina displays at the rendered
 * width="240".
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

async function main() {
  const [, , inputArg, outputArg, maxHeightArg] = process.argv;
  if (!inputArg || !outputArg) {
    console.error(
      "usage: pnpm tsx scripts/crop-readme-screenshot.ts <input.png> <output.png> [maxHeightPx]",
    );
    process.exit(1);
  }
  const input = resolve(inputArg);
  const output = resolve(outputArg);
  const maxHeight = Number(maxHeightArg ?? "1600");
  if (!existsSync(input)) {
    console.error(`input does not exist: ${input}`);
    process.exit(1);
  }

  const img = sharp(input);
  const meta = await img.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) {
    console.error("could not read input dimensions");
    process.exit(1);
  }
  const cropHeight = Math.min(height, maxHeight);
  await sharp(input)
    .extract({ left: 0, top: 0, width, height: cropHeight })
    .resize({ width: Math.min(width, 760), withoutEnlargement: true })
    .png({ compressionLevel: 9, quality: 90 })
    .toFile(output);

  console.log(
    `wrote ${output} (cropped ${width}x${cropHeight} → resized to max-width 760)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
