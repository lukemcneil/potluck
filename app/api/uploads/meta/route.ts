import { NextResponse } from "next/server";
import sharp from "sharp";

import { auth } from "@/lib/auth";
import { storage } from "@/lib/storage";
import { makePlaceholder } from "@/lib/images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IDS = 8;

/**
 * Re-derive UploadedPhoto-shape metadata for a set of stored upload
 * ids. Used by `AddRecipeFlow` when seeding from a Web Share Target
 * payload — the OS shared raw images, /share-receive normalized them,
 * and now the client wants the dimensions + placeholder back so it
 * can render thumbnails identical to the in-app PhotoPicker output.
 *
 * We could have stashed this metadata in a cookie at share-receive
 * time, but mutating cookies from a server component is restricted in
 * Next 15+ and the round-trip stays trivial.
 */
export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const idsParam = url.searchParams.get("ids") ?? "";
  const ids = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z0-9_-]{6,32}$/.test(s))
    .slice(0, MAX_IDS);

  if (ids.length === 0) {
    return NextResponse.json({ files: [] });
  }

  const files: Array<{
    id: string;
    publicPath: string;
    width: number;
    height: number;
    placeholder: string;
  }> = [];

  for (const id of ids) {
    const obj = await storage.read(id);
    if (!obj) continue;
    try {
      const meta = await sharp(obj.buffer).metadata();
      const placeholder = await makePlaceholder(obj.buffer);
      // Reconstruct the public path from the mime type via storage's
      // own pathFor — keeps the source of truth in one place.
      const ext = meta.format ?? "jpg";
      files.push({
        id,
        publicPath: storage.pathFor(id, ext === "jpeg" ? "jpg" : ext),
        width: meta.width ?? 0,
        height: meta.height ?? 0,
        placeholder,
      });
    } catch (err) {
      console.warn("[uploads/meta] sharp-failed", { id, err });
    }
  }

  return NextResponse.json({ files });
}
