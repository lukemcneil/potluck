import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { UPLOADS_DIR } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path: parts } = await context.params;
  if (!parts || parts.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const requested = path.join(...parts);
  const absolute = path.resolve(path.join(UPLOADS_DIR, requested));

  if (!absolute.startsWith(path.resolve(UPLOADS_DIR))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(absolute);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ext = path.extname(absolute).slice(1).toLowerCase();
  const mime = mimeFor(ext);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

function mimeFor(ext: string): string {
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "gif":
      return "image/gif";
    case "heic":
      return "image/heic";
    default:
      return "application/octet-stream";
  }
}
