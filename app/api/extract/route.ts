import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { extractRecipe } from "@/lib/ai/extract-recipe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.union([
  z.object({
    kind: z.literal("imageIds"),
    imageIds: z.array(z.string().min(1)).min(1).max(8),
  }),
  z.object({
    kind: z.literal("url"),
    url: z.string().url(),
  }),
]);

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const recipe = await extractRecipe(parsed.data);
    return NextResponse.json({ recipe });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Extraction failed";
    const isUserError =
      message.startsWith("OPENAI_API_KEY") || message.startsWith("Image not found");
    return NextResponse.json(
      { error: message },
      { status: isUserError ? 400 : 500 },
    );
  }
}
