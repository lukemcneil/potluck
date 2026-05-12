"use client";

import { AlertTriangle, Check, Plus, Sparkles, X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Tiny presentational review strip used by the recipe-import review
 * step. Sits above the row's inputs with a yellow border and a row of
 * action buttons (no business logic — the parent decides what each
 * action does). Keep it presentational so the form stays the single
 * source of truth for resolution state.
 *
 * `tone` controls the strip's color — yellow for the standard
 * "double-check this" case, green for the rare success-fading case
 * (currently unused; reserved for future flows like "verifier said
 * the same thing").
 */
type Action = {
  label: string;
  onClick: () => void;
  variant?: "primary" | "neutral" | "danger";
};

export function ReviewStrip({
  reasons,
  actions,
  tone = "warning",
  hint,
}: {
  reasons: string[];
  actions: Action[];
  tone?: "warning";
  hint?: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label="Verification suggestion"
      className={cn(
        "rounded-lg border border-amber-300/60 bg-amber-50 p-2.5 text-amber-900",
        "dark:border-amber-300/30 dark:bg-amber-300/10 dark:text-amber-100",
        tone, // currently always "warning" — kept as data attr in case we add tones
      )}
      data-print="hide"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="flex-1 space-y-0.5 text-xs leading-snug">
          {reasons.map((r, i) => (
            <p key={i}>{r}</p>
          ))}
          {hint && <div className="text-[11px] opacity-80">{hint}</div>}
        </div>
      </div>
      {actions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {actions.map((a, i) => (
            <button
              key={`${a.label}-${i}`}
              type="button"
              onClick={a.onClick}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition",
                a.variant === "danger"
                  ? "border-red-300 bg-white text-red-700 hover:bg-red-50 dark:border-red-300/30 dark:bg-red-950/20 dark:text-red-200"
                  : a.variant === "neutral"
                    ? "border-amber-300/70 bg-white text-amber-900 hover:bg-amber-100 dark:border-amber-300/30 dark:bg-transparent dark:text-amber-100"
                    : "border-amber-400 bg-amber-100 text-amber-950 hover:bg-amber-200 dark:border-amber-300/40 dark:bg-amber-300/20 dark:text-amber-50",
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Visual primitives for the action buttons. */
ReviewStrip.icons = { Check, Plus, X, Sparkles };
