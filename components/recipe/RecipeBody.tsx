"use client";

import { useMemo, useState } from "react";

import { Separator } from "@/components/ui/separator";
import {
  ServingsControl,
  deriveScalingMode,
} from "@/components/recipe/ServingsControl";
import { UnscaledBadge } from "@/components/recipe/UnscaledBadge";
import {
  formatIngredientPrefix,
  formatQuantity,
  pluralizeUnit,
  scaleStepText,
} from "@/lib/cooking/scale";
import { cn } from "@/lib/utils";

export type IngredientRow = {
  id: string;
  quantity: string | null;
  /**
   * Parsed-numeric companion of `quantity`. Set at write time by
   * `deriveNumeric()` in the server actions; null when the text is
   * non-numeric ("a pinch", "to taste") so we can render an honest
   * "won't scale" note instead of silently leaving the value at the
   * original.
   */
  quantityNumeric: number | null;
  unit: string | null;
  name: string;
  note: string | null;
};

export type StepRow = {
  id: string;
  body: string;
};

type Props = {
  ingredients: IngredientRow[];
  steps: StepRow[];
  /**
   * Author's free-text servings string ("12", "4-6 people", "1 loaf").
   * Used as the visible "originally serves N" hint.
   */
  servings: string | null;
  /**
   * Parsed-numeric servings companion. When set, the stepper operates
   * on servings count (12 → 24). When null, the recipe has a
   * non-numeric yield ("1 loaf") and the stepper switches to a
   * multiplier mode (1× → 2× → ½×). Either way, every recipe is
   * scalable — the only thing that changes is the UI semantics.
   */
  servingsNumeric: number | null;
};

/**
 * Combined Ingredients + Steps view for the recipe detail page.
 *
 * Single source of truth for the scaling factor: the ServingsControl
 * emits a target number (servings count or raw multiplier depending
 * on mode), this component converts that into a multiplier `factor`,
 * and that factor flows into per-ingredient and per-step rescaling.
 *
 * Scaling rules:
 *   - Ingredients WITH `quantityNumeric` (parseable): multiply, snap
 *     to eighths, render with Unicode glyphs.
 *   - Ingredients WITHOUT `quantityNumeric` ("a pinch", "to taste"):
 *     show the original text and append a small "won't scale" badge
 *     when the user has actually rescaled. The badge avoids the old
 *     dishonest "looks like it scaled" failure mode where the line
 *     silently stayed at the original amount while the rest moved.
 *   - Steps: regex-based rescale of "<qty> <unit>" tokens via
 *     scaleStepText. Step prose has no per-token numeric companion
 *     today; this stays best-effort.
 */
export function RecipeBody({
  ingredients,
  steps,
  servings,
  servingsNumeric,
}: Props) {
  // Mode = "servings" when the author's yield parses as a number ("12"),
  // "multiplier" otherwise ("1 loaf"). Both end up at the same `factor`.
  const { mode, base } = deriveScalingMode(servingsNumeric);
  const [target, setTarget] = useState<number>(base);
  const factor = target > 0 ? target / base : 1;
  const scaled = Math.abs(factor - 1) > 1e-6;

  const scaledIngredients = useMemo(
    () =>
      ingredients.map((ing) => {
        const canScale = ing.quantityNumeric != null;
        if (!canScale) {
          return {
            ...ing,
            displayQuantity: ing.quantity ?? "",
            displayUnit: ing.unit ?? "",
            unscaled: scaled && !!ing.quantity,
          };
        }
        // Multiply the parsed-once numeric and re-render. We
        // deliberately don't try to preserve "1-2" range round-trip
        // here: ranges store midpoint in quantityNumeric, so a
        // scaled-output of "1-2" × 2 is rendered as a single glyph
        // (the midpoint × 2), not a range. The author-facing wording
        // for ranges is captured in the original `quantity` text and
        // is visible un-scaled at factor=1.
        const displayQuantity =
          factor === 1 && ing.quantity
            ? // Preserve the author's wording at base servings —
              // "1½", "1 1/2", and "1-2" all stay exactly as typed
              // until the user starts scaling.
              ing.quantity
            : formatQuantity(ing.quantityNumeric! * factor);
        return {
          ...ing,
          displayQuantity,
          displayUnit: pluralizeUnit(ing.unit, displayQuantity),
          unscaled: false,
        };
      }),
    [ingredients, factor, scaled],
  );

  return (
    <>
      {ingredients.length > 0 && (
        <>
          <Separator className="my-8" />
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-xl font-semibold">Ingredients</h2>
              <ServingsControl
                mode={mode}
                base={base}
                value={target}
                originalText={servings}
                onChange={setTarget}
              />
            </div>

            <ul className="mt-3 space-y-2">
              {scaledIngredients.map((ing) => {
                const prefix = formatIngredientPrefix(
                  ing.displayQuantity,
                  ing.displayUnit,
                  ing.name,
                );
                return (
                  <li key={ing.id} className="flex gap-3 text-sm">
                    <span
                      className={cn(
                        "mt-2 size-1.5 shrink-0 rounded-full",
                        ing.unscaled ? "bg-muted-foreground/40" : "bg-primary/60",
                      )}
                    />
                    <span className={cn(ing.unscaled && "text-muted-foreground")}>
                      {prefix && <>{prefix} </>}
                      <span className="font-medium text-foreground">
                        {ing.name}
                      </span>
                      {ing.note && (
                        <span className="text-muted-foreground">, {ing.note}</span>
                      )}
                      {ing.unscaled && (
                        <UnscaledBadge originalQuantity={ing.quantity} />
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}

      {steps.length > 0 && (
        <>
          <Separator className="my-8" />
          <section>
            <h2 className="font-display text-xl font-semibold">Steps</h2>
            <ol className="mt-3 space-y-4">
              {steps.map((s, i) => (
                <li key={s.id} className="flex gap-4">
                  {/*
                    The number circle is decorative — it duplicates the
                    list position, which the announced "Step N:" prefix
                    below already conveys. Hiding it from a11y avoids
                    "1Mix flour" smushed announcements from screen readers
                    that concatenate sibling inline-flex children.
                  */}
                  <span
                    aria-hidden="true"
                    className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
                  >
                    {i + 1}
                  </span>
                  <p className="pt-0.5 text-sm leading-relaxed">
                    <span className="sr-only">{`Step ${i + 1}: `}</span>
                    {scaled ? scaleStepText(s.body, factor) : s.body}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </>
  );
}
