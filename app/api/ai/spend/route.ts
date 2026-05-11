import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { monthlySpendForUser } from "@/lib/queries/ai-usage";
import { userMonthlyCapUsd } from "@/lib/ai/cap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns the signed-in user's MTD AI spend + the configured cap. Used
 * by the AddRecipeFlow to decide whether to show a "you're approaching
 * your budget" hint before kicking off another extraction.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const cap = userMonthlyCapUsd();
  const spend = await monthlySpendForUser(session.user.id);
  return NextResponse.json({
    totalUsd: spend.totalUsd,
    capUsd: cap,
  });
}
