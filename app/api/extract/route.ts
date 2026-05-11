import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { extractRecipe, URL_MODEL } from "@/lib/ai/extract-recipe";
import {
  monthlySpendForUser,
  recordAiUsage,
} from "@/lib/queries/ai-usage";
import {
  userMonthlyCapUsd,
  userMonthlySoftCapUsd,
} from "@/lib/ai/cap";

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
  const userId = session.user.id;

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

  const cap = userMonthlyCapUsd();
  const softCap = userMonthlySoftCapUsd();
  const spendBefore = cap != null ? await monthlySpendForUser(userId) : null;

  if (cap != null && spendBefore && spendBefore.totalUsd >= cap) {
    return NextResponse.json(
      {
        error:
          "You've hit your AI extraction budget for this month. Please try again next month, or type the recipe in by hand.",
        spend: {
          totalUsd: spendBefore.totalUsd,
          capUsd: cap,
        },
      },
      { status: 402 },
    );
  }

  // Soft cap: once a user is past ~⅔ of their monthly budget, route
  // image extractions through the cheaper model instead of gpt-4o.
  // URL extraction already uses mini, so it doesn't need a downgrade.
  let modelOverride: string | undefined;
  let degraded = false;
  if (
    cap != null &&
    softCap != null &&
    spendBefore != null &&
    spendBefore.totalUsd >= softCap &&
    parsed.data.kind === "imageIds"
  ) {
    modelOverride = URL_MODEL;
    degraded = true;
  }

  try {
    const result = await extractRecipe(parsed.data, { modelOverride });

    // Persist usage so we can bill / cap reliably. We do this even
    // when the model said "no recipe" — the call still burned tokens.
    // Best-effort; if it fails we still return the result.
    await recordAiUsage({
      userId,
      model: result.cost.modelId,
      inputTokens: result.cost.inputTokens,
      outputTokens: result.cost.outputTokens,
      costUsd: result.cost.totalCost,
    });

    const totalAfter =
      (spendBefore?.totalUsd ?? 0) + result.cost.totalCost;
    const spendPayload =
      cap != null
        ? { totalUsd: totalAfter, capUsd: cap, degraded }
        : null;

    const costPayload = {
      modelId: result.cost.modelId,
      inputTokens: result.cost.inputTokens,
      outputTokens: result.cost.outputTokens,
      cachedInputTokens: result.cost.cachedInputTokens,
      totalUsd: result.cost.totalCost,
    };

    if (result.kind === "no-recipe") {
      return NextResponse.json(
        {
          error: "no_recipe_found",
          reason: result.reason,
          cost: costPayload,
          spend: spendPayload,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      recipe: result.recipe,
      cost: costPayload,
      spend: spendPayload,
    });
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
