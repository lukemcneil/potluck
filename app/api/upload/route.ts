import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { storage } from "@/lib/storage";
import { processUpload, makePlaceholder } from "@/lib/images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB / file
const MAX_FILES = 8;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json(
      { error: `Too many files (max ${MAX_FILES})` },
      { status: 400 },
    );
  }

  const results = [];
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `File ${file.name} is too large (max 25MB)` },
        { status: 400 },
      );
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.type}` },
        { status: 400 },
      );
    }

    const raw = Buffer.from(await file.arrayBuffer());
    const processed = await processUpload(raw);
    const stored = await storage.put({
      buffer: processed.buffer,
      ext: processed.ext,
      mimeType: processed.mimeType,
    });
    const placeholder = await makePlaceholder(processed.buffer);

    results.push({
      id: stored.id,
      publicPath: stored.publicPath,
      width: processed.width,
      height: processed.height,
      placeholder,
    });
  }

  return NextResponse.json({ files: results });
}
