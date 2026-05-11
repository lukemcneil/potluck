import type { Metadata } from "next";

import { requireSession } from "@/lib/session";
import {
  AddRecipeFlow,
  type ShareIntent,
} from "@/components/upload/AddRecipeFlow";
import { monthlySpendForUser } from "@/lib/queries/ai-usage";
import { userMonthlyCapUsd } from "@/lib/ai/cap";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Add a recipe",
  description: "Snap a recipe card or paste a link and we'll do the rest.",
};

export default async function AddRecipePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession("/add");

  // Seed the flow with the user's MTD spend + cap so the "approaching
  // your budget" banner can render on the very first extraction without
  // an extra round trip.
  const capUsd = userMonthlyCapUsd();
  const spend = await monthlySpendForUser(session.user.id);
  const initialAiSpend = { totalUsd: spend.totalUsd, capUsd };

  const sp = await searchParams;
  const initialShare = parseShareIntent(sp);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <AddRecipeFlow
        initialAiSpend={initialAiSpend}
        initialShare={initialShare}
      />
    </div>
  );
}

/**
 * Decode the `?shared=...` payload that `/share-receive` writes when
 * Potluck is launched via the OS share sheet. Returns null when the
 * params don't describe a valid share.
 */
function parseShareIntent(
  sp: Record<string, string | string[] | undefined>,
): ShareIntent | null {
  const kind = pickStr(sp.shared);
  if (!kind) return null;
  const title = pickStr(sp.title) ?? null;
  if (kind === "url") {
    const url = pickStr(sp.url);
    if (!url) return null;
    return { kind: "url", url, title };
  }
  if (kind === "photos") {
    const idsStr = pickStr(sp.ids);
    const ids = idsStr
      ? idsStr.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    if (ids.length === 0) return null;
    return { kind: "photo-ids", ids, title };
  }
  if (kind === "text") {
    return {
      kind: "text",
      text: pickStr(sp.text) ?? null,
      title,
    };
  }
  return null;
}

function pickStr(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}
