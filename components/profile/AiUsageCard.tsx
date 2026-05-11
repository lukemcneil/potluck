import { Sparkles } from "lucide-react";

import { formatUsd } from "@/lib/ai/pricing";
import type { MonthlySpend } from "@/lib/queries/ai-usage";

type Props = {
  spend: MonthlySpend;
  capUsd: number | null;
};

/**
 * Small widget on the owner's own profile showing their MTD spend on
 * AI extractions. Only shown when they have usage > 0 (or a cap is
 * configured) so new users aren't presented with a meaningless $0
 * card.
 */
export function AiUsageCard({ spend, capUsd }: Props) {
  if (spend.totalCalls === 0 && capUsd == null) return null;

  const pct =
    capUsd != null && capUsd > 0
      ? Math.min(100, Math.round((spend.totalUsd / capUsd) * 100))
      : null;

  return (
    <div className="rounded-2xl border border-border bg-card/70 px-4 py-3 text-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Sparkles className="size-4 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wide">
          AI usage this month
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="font-display text-xl font-semibold tabular-nums">
          {formatUsd(spend.totalUsd)}
        </span>
        <span className="text-xs text-muted-foreground">
          {`${spend.totalCalls} extraction${spend.totalCalls === 1 ? "" : "s"}`}
          {capUsd != null ? ` of ${formatUsd(capUsd)} cap` : ""}
        </span>
      </div>

      {pct != null && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {spend.byModel.length > 1 && (
        <ul className="mt-3 grid gap-1 text-xs text-muted-foreground">
          {spend.byModel.map((m) => {
            const costAndCalls = `${formatUsd(m.costUsd)} · ${m.calls} call${m.calls === 1 ? "" : "s"}`;
            return (
              <li
                key={m.model}
                // The <li> is not interactive, but a screen reader will
                // still announce its descendant text as a single string
                // ("gpt-4o$0.1431 · 4 calls"). An aria-label keeps the
                // model and cost separated by a comma in announcements.
                aria-label={`${m.model}, ${costAndCalls}`}
                className="flex justify-between gap-2"
              >
                <span className="font-mono">{m.model}</span>
                <span className="tabular-nums">{costAndCalls}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
