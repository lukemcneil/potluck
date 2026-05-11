import type { Metadata } from "next";

import { requireSession } from "@/lib/session";
import { AddRecipeFlow } from "@/components/upload/AddRecipeFlow";
import { monthlySpendForUser } from "@/lib/queries/ai-usage";
import { userMonthlyCapUsd } from "@/lib/ai/cap";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Add a recipe",
  description: "Snap a recipe card or paste a link and we'll do the rest.",
};

export default async function AddRecipePage() {
  const session = await requireSession("/add");

  // Seed the flow with the user's MTD spend + cap so the "approaching
  // your budget" banner can render on the very first extraction without
  // an extra round trip.
  const capUsd = userMonthlyCapUsd();
  const spend = await monthlySpendForUser(session.user.id);
  const initialAiSpend = { totalUsd: spend.totalUsd, capUsd };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <AddRecipeFlow initialAiSpend={initialAiSpend} />
    </div>
  );
}
