"use client";

import { Minus, Plus, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatQuantity } from "@/lib/cooking/scale";

/**
 * Servings / scale stepper used by both the recipe detail page
 * (`RecipeBody`) and the full-screen cook view (`CookMode`). Has two
 * interaction modes:
 *
 *   - `"servings"`: the recipe's yield parses as a number (e.g. "12").
 *     Stepper bumps the integer servings count, ±1 per click,
 *     bounded to [1, 99]. Display shows the integer.
 *
 *   - `"multiplier"`: the yield is non-numeric ("1 loaf", "a dozen").
 *     Anchor is fixed at 1× and the stepper walks a small ladder of
 *     cook-friendly fractions (½×, ⅔×, 1×, 1½×, 2×, 3×…). Display
 *     shows the multiplier using the same Unicode-glyph formatter
 *     ingredient quantities use, so the whole UI reads consistently.
 *
 * Both modes emit `value` as a plain number; the parent converts it
 * into a scale factor via `value / base`. The author's original
 * free-text yield can be passed as `originalText` and is shown as a
 * subtle hint next to the stepper in multiplier mode.
 *
 * Exported separately so we don't fork the math/labels across the
 * two consumers — every behavior change to scaling lives here.
 */
export type ServingsControlMode = "servings" | "multiplier";

type Props = {
  mode: ServingsControlMode;
  /** Anchor value: original servings count (in servings mode) or 1 (in multiplier mode). */
  base: number;
  /** Current target the user has dialed in (servings count OR multiplier). */
  value: number;
  /** Author's free-text yield ("1 loaf"); shown as a hint in multiplier mode. */
  originalText: string | null;
  onChange: (next: number) => void;
  /** Optional override class for the container; lets CookMode squeeze it into a tight header. */
  className?: string;
};

export function ServingsControl({
  mode,
  base,
  value,
  originalText,
  onChange,
  className,
}: Props) {
  const isModified = Math.abs(value - base) > 1e-6;

  const dec = () => {
    if (mode === "servings") {
      onChange(Math.max(1, Math.round(value) - 1));
    } else {
      onChange(prevMultiplier(value));
    }
  };
  const inc = () => {
    if (mode === "servings") {
      onChange(Math.min(99, Math.round(value) + 1));
    } else {
      onChange(nextMultiplier(value));
    }
  };

  const display =
    mode === "servings" ? prettyServings(value) : formatMultiplier(value);
  const stepperLabel = mode === "servings" ? "Servings" : "Scale";
  const a11yLabel =
    mode === "servings" ? `Servings: ${display}` : `Scale: ${display}`;

  return (
    <div
      className={
        "flex items-center gap-2 text-sm" +
        (className ? ` ${className}` : "")
      }
    >
      <span className="text-xs text-muted-foreground" aria-hidden>
        {stepperLabel}
      </span>
      <div
        className="inline-flex items-center overflow-hidden rounded-full border border-border"
        role="group"
        aria-label={a11yLabel}
      >
        <button
          type="button"
          onClick={dec}
          aria-label={mode === "servings" ? "Fewer servings" : "Scale down"}
          className="flex size-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Minus className="size-3.5" />
        </button>
        <span
          className="min-w-10 px-1 text-center font-semibold tabular-nums"
          aria-hidden
        >
          {display}
        </span>
        <button
          type="button"
          onClick={inc}
          aria-label={mode === "servings" ? "More servings" : "Scale up"}
          className="flex size-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      {isModified && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange(base)}
          className="h-7 gap-1 px-2 text-xs"
        >
          <RotateCcw className="size-3" />
          Reset
        </Button>
      )}
      {mode === "multiplier" && originalText && (
        <span className="text-xs text-muted-foreground" aria-hidden>
          {`(${originalText})`}
        </span>
      )}
    </div>
  );
}

/**
 * Pick the scaling mode + anchor for a recipe given its `servings`
 * text and `servingsNumeric` parsed-companion. Pure: returns the
 * pair the consumer wires into their local `useState`.
 *   - When servingsNumeric > 0: servings mode, anchor at that count.
 *   - Otherwise: multiplier mode, anchor at 1×. Every recipe stays
 *     scalable; only the UI semantics change.
 */
export function deriveScalingMode(
  servingsNumeric: number | null,
): { mode: ServingsControlMode; base: number } {
  if (servingsNumeric != null && servingsNumeric > 0) {
    return { mode: "servings", base: servingsNumeric };
  }
  return { mode: "multiplier", base: 1 };
}

function prettyServings(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1).replace(/\.0$/, "");
}

/**
 * Render the multiplier in the same Unicode-glyph style as ingredient
 * quantities so the whole detail page reads consistently.
 *   1   -> "1×"
 *   0.5 -> "½×"
 *   1.5 -> "1 ½×"
 *   2   -> "2×"
 */
function formatMultiplier(n: number): string {
  return `${formatQuantity(n)}\u00D7`; // ×
}

/**
 * Sparse multiplier ladder used by the stepper. Keeps the user on
 * cook-friendly fractions instead of letting them dial in 1.137×.
 * Exported for tests; not part of the public API otherwise.
 */
export const MULTIPLIER_LADDER = [
  1 / 4,
  1 / 3,
  1 / 2,
  2 / 3,
  3 / 4,
  1,
  1.5,
  2,
  3,
  4,
  6,
  8,
];

export function nextMultiplier(current: number): number {
  for (const v of MULTIPLIER_LADDER) {
    if (v > current + 1e-6) return v;
  }
  return MULTIPLIER_LADDER[MULTIPLIER_LADDER.length - 1];
}

export function prevMultiplier(current: number): number {
  for (let i = MULTIPLIER_LADDER.length - 1; i >= 0; i--) {
    if (MULTIPLIER_LADDER[i] < current - 1e-6) return MULTIPLIER_LADDER[i];
  }
  return MULTIPLIER_LADDER[0];
}
