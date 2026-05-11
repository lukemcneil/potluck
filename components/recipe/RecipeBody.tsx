"use client";

import { useMemo, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  formatIngredientPrefix,
  parseQuantity,
  pluralizeUnit,
  scaleQuantity,
  scaleStepText,
} from "@/lib/cooking/scale";

export type IngredientRow = {
  id: string;
  quantity: string | null;
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
   * The recipe's original servings string. We only render the scaler
   * when this parses to a single number (e.g. "4"); ranges and
   * unparseable strings just show the raw ingredients with no scaling.
   */
  servings: string | null;
};

/**
 * Combined Ingredients + Steps view for the recipe detail page.
 *
 * The two sections share a single servings scaler so changing servings
 * also rescales any "<qty> <unit>" tokens embedded in the step prose
 * (e.g. "Add 3 cups broth" -> "Add 1 1/2 cups broth").
 */
export function RecipeBody({ ingredients, steps, servings }: Props) {
  const baseServings = useMemo(() => {
    const parsed = parseQuantity(servings ?? null);
    if (!parsed) return null;
    if (parsed.kind === "single" && parsed.value > 0) return parsed.value;
    if (parsed.kind === "range" && parsed.low > 0) return parsed.low;
    return null;
  }, [servings]);

  const [target, setTarget] = useState<number | null>(baseServings);
  const factor =
    baseServings != null && target != null && target > 0
      ? target / baseServings
      : 1;
  const scaled = factor !== 1;

  const scaledIngredients = useMemo(
    () =>
      ingredients.map((ing) => {
        const scaledQuantity = ing.quantity ? scaleQuantity(ing.quantity, factor) : "";
        return {
          ...ing,
          scaledQuantity,
          scaledUnit: pluralizeUnit(ing.unit, scaledQuantity || ing.quantity),
        };
      }),
    [ingredients, factor],
  );

  return (
    <>
      {ingredients.length > 0 && (
        <>
          <Separator className="my-8" />
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-xl font-semibold">Ingredients</h2>
              {baseServings != null && target != null && (
                <ServingsControl
                  base={baseServings}
                  value={target}
                  onChange={setTarget}
                />
              )}
            </div>

            <ul className="mt-3 space-y-2">
              {scaledIngredients.map((ing) => {
                const prefix = formatIngredientPrefix(
                  ing.scaledQuantity || ing.quantity,
                  ing.scaledUnit || ing.unit,
                  ing.name,
                );
                return (
                  <li key={ing.id} className="flex gap-3 text-sm">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/60" />
                    <span>
                      {prefix && <>{prefix} </>}
                      <span className="font-medium">{ing.name}</span>
                      {ing.note && (
                        <span className="text-muted-foreground">, {ing.note}</span>
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

function ServingsControl({
  base,
  value,
  onChange,
}: {
  base: number;
  value: number;
  onChange: (next: number) => void;
}) {
  const dec = () => onChange(Math.max(1, Math.round(value) - 1));
  const inc = () => onChange(Math.min(99, Math.round(value) + 1));
  const isModified = Math.abs(value - base) > 1e-6;

  const display = prettyServings(value);
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-xs text-muted-foreground" aria-hidden>
        Servings
      </span>
      <div
        className="inline-flex items-center overflow-hidden rounded-full border border-border"
        role="group"
        aria-label={`Servings: ${display}`}
      >
        <button
          type="button"
          onClick={dec}
          aria-label="Fewer servings"
          className="flex size-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Minus className="size-3.5" />
        </button>
        <span
          className="min-w-8 px-1 text-center font-semibold tabular-nums"
          aria-hidden
        >
          {display}
        </span>
        <button
          type="button"
          onClick={inc}
          aria-label="More servings"
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
    </div>
  );
}

function prettyServings(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1).replace(/\.0$/, "");
}
