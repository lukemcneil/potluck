import "server-only";

import sharp from "sharp";

export type ProcessedImage = {
  /** Re-encoded buffer (jpeg or webp depending on input) suitable for storage. */
  buffer: Buffer;
  /** Final extension to use when persisting. */
  ext: "jpg" | "webp" | "png";
  /** Final mime type. */
  mimeType: string;
  width: number;
  height: number;
};

const MAX_DIM = 2048;

/**
 * Take a raw upload buffer (any common image format including HEIC) and
 * return a normalized version: rotated according to EXIF, resized to fit
 * within a 2048px box, encoded as a single format we know browsers handle.
 */
export async function processUpload(input: Buffer): Promise<ProcessedImage> {
  const pipeline = sharp(input, { failOn: "none" }).rotate();
  const metadata = await pipeline.metadata();

  const fmt = pickOutputFormat(metadata.format ?? "jpeg");

  const resized = pipeline.clone().resize({
    width: MAX_DIM,
    height: MAX_DIM,
    fit: "inside",
    withoutEnlargement: true,
  });

  let encoded: { buffer: Buffer; ext: "jpg" | "webp" | "png"; mimeType: string };

  if (fmt === "png") {
    const buf = await resized.png({ quality: 90, compressionLevel: 9 }).toBuffer();
    encoded = { buffer: buf, ext: "png", mimeType: "image/png" };
  } else if (fmt === "webp") {
    const buf = await resized.webp({ quality: 88 }).toBuffer();
    encoded = { buffer: buf, ext: "webp", mimeType: "image/webp" };
  } else {
    const buf = await resized
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer();
    encoded = { buffer: buf, ext: "jpg", mimeType: "image/jpeg" };
  }

  const { width = 0, height = 0 } = await sharp(encoded.buffer).metadata();

  return { ...encoded, width, height };
}

function pickOutputFormat(input: string): "jpg" | "webp" | "png" {
  if (input === "png") return "png";
  if (input === "webp") return "webp";
  return "jpg";
}

/**
 * Generate a tiny base64 placeholder for use as `placeholder="data:..."` on
 * Next/Image while the full asset loads. We keep it simple here (no blurhash
 * library) — an 8px wide blurred jpeg is good enough and zero-dep.
 */
export async function makePlaceholder(buffer: Buffer): Promise<string> {
  const tiny = await sharp(buffer)
    .resize({ width: 16, height: 16, fit: "inside" })
    .jpeg({ quality: 50 })
    .toBuffer();
  return `data:image/jpeg;base64,${tiny.toString("base64")}`;
}
