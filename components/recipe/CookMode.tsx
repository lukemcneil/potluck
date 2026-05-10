"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  X,
  Check,
  Lightbulb,
  Minus,
  Plus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { parseQuantity, pluralizeUnit, scaleQuantity } from "@/lib/cooking/scale";
import { cn } from "@/lib/utils";

type Ingredient = {
  id: string;
  quantity: string | null;
  unit: string | null;
  name: string;
  note: string | null;
};

type Step = { id: string; body: string };

type Recipe = {
  id: string;
  title: string;
  servings: string | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
};

type Props = {
  recipe: Recipe;
  ingredients: Ingredient[];
  steps: Step[];
};

/**
 * Full-screen cooking view: large readable type, dimmable chrome,
 * step-by-step nav, and screen-wake-lock so the device doesn't sleep
 * while you're elbow-deep in flour.
 */
export function CookMode({ recipe, ingredients, steps }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [doneSteps, setDoneSteps] = useState<Set<number>>(new Set());
  const [doneIngredients, setDoneIngredients] = useState<Set<string>>(new Set());
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // Servings scaler (same logic as IngredientsList).
  const baseServings = useMemo(() => {
    const parsed = parseQuantity(recipe.servings ?? null);
    if (!parsed) return null;
    if (parsed.kind === "single" && parsed.value > 0) return parsed.value;
    if (parsed.kind === "range" && parsed.low > 0) return parsed.low;
    return null;
  }, [recipe.servings]);
  const [target, setTarget] = useState<number | null>(baseServings);
  const factor =
    baseServings != null && target != null && target > 0
      ? target / baseServings
      : 1;

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

  // Screen wake lock — best-effort. Re-acquired when the tab becomes
  // visible again because browsers release the lock on visibilitychange.
  useEffect(() => {
    let cancelled = false;

    async function acquire() {
      const nav = navigator as Navigator & {
        wakeLock?: { request(type: "screen"): Promise<WakeLockSentinel> };
      };
      if (!nav.wakeLock) return;
      try {
        const lock = await nav.wakeLock.request("screen");
        if (cancelled) {
          await lock.release();
          return;
        }
        wakeLockRef.current = lock;
      } catch {
        // Silently ignore — wake lock is a nice-to-have.
      }
    }

    void acquire();

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !wakeLockRef.current) {
        void acquire();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, []);

  const totalSteps = steps.length;
  const currentStep = steps[stepIndex];

  const goPrev = () => setStepIndex((i) => Math.max(0, i - 1));
  const goNext = () => {
    setDoneSteps((prev) => new Set(prev).add(stepIndex));
    setStepIndex((i) => Math.min(totalSteps - 1, i + 1));
  };

  const toggleIngredient = (id: string) => {
    setDoneIngredients((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border bg-background/90 px-4 py-3 backdrop-blur sm:px-6">
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Cooking
          </p>
          <h1 className="truncate font-display text-base font-semibold sm:text-lg">
            {recipe.title}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {baseServings != null && target != null && (
            <ServingsControl base={baseServings} value={target} onChange={setTarget} />
          )}
          <Link href={`/r/${recipe.id}`}>
            <Button variant="ghost" size="icon" aria-label="Exit cook mode">
              <X className="size-5" />
            </Button>
          </Link>
        </div>
      </header>

      <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
        <aside className="shrink-0 overflow-y-auto border-b border-border md:w-80 md:border-r md:border-b-0">
          <div className="px-4 py-4 sm:px-6">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Ingredients
              </h2>
              {doneIngredients.size > 0 && (
                <button
                  type="button"
                  onClick={() => setDoneIngredients(new Set())}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Reset
                </button>
              )}
            </div>
            {scaledIngredients.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No ingredients listed for this recipe.
              </p>
            ) : (
              <ul className="mt-3 space-y-1.5">
                {scaledIngredients.map((ing) => {
                  const checked = doneIngredients.has(ing.id);
                  return (
                    <li key={ing.id}>
                      <button
                        type="button"
                        onClick={() => toggleIngredient(ing.id)}
                        className={cn(
                          "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition",
                          checked
                            ? "text-muted-foreground line-through"
                            : "hover:bg-muted",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
                            checked
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border",
                          )}
                          aria-hidden
                        >
                          {checked && <Check className="size-3" />}
                        </span>
                        <span>
                          {[ing.scaledQuantity || ing.quantity, ing.scaledUnit || ing.unit]
                            .filter(Boolean)
                            .join(" ")}
                          {ing.quantity || ing.unit ? " " : ""}
                          <span className="font-medium">{ing.name}</span>
                          {ing.note && (
                            <span className="text-muted-foreground">, {ing.note}</span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        <main className="flex flex-1 flex-col overflow-y-auto">
          {totalSteps === 0 ? (
            <div className="m-auto flex max-w-md flex-col items-center px-6 py-12 text-center">
              <Lightbulb className="size-10 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">
                This recipe has no steps yet. Open the original recipe to see
                photos or notes.
              </p>
              <Link href={`/r/${recipe.id}`} className="mt-4">
                <Button variant="outline">Back to recipe</Button>
              </Link>
            </div>
          ) : (
            <>
              <div className="flex flex-1 flex-col px-6 py-8 sm:px-12 sm:py-12">
                <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
                  <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                    Step {stepIndex + 1} of {totalSteps}
                  </p>
                  <p className="mt-4 font-display text-2xl leading-snug sm:text-3xl">
                    {currentStep?.body}
                  </p>

                  {totalSteps > 1 && (
                    <ol className="mt-8 hidden gap-2 sm:flex sm:flex-wrap">
                      {steps.map((s, i) => (
                        <li key={s.id}>
                          <button
                            type="button"
                            onClick={() => setStepIndex(i)}
                            className={cn(
                              "flex size-8 items-center justify-center rounded-full text-xs font-semibold transition",
                              i === stepIndex
                                ? "bg-primary text-primary-foreground"
                                : doneSteps.has(i)
                                  ? "bg-primary/15 text-primary"
                                  : "bg-muted text-muted-foreground hover:bg-muted/70",
                            )}
                            aria-label={`Go to step ${i + 1}`}
                          >
                            {i + 1}
                          </button>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>

              <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-border bg-background/95 px-4 py-4 backdrop-blur sm:px-6">
                <Button
                  variant="outline"
                  onClick={goPrev}
                  disabled={stepIndex === 0}
                  className="gap-1.5"
                  size="lg"
                >
                  <ChevronLeft className="size-4" />
                  Back
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {stepIndex + 1} / {totalSteps}
                </span>
                <Button
                  onClick={goNext}
                  disabled={stepIndex === totalSteps - 1}
                  className="gap-1.5"
                  size="lg"
                >
                  Next
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
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
  void base;
  return (
    <div className="inline-flex items-center overflow-hidden rounded-full border border-border text-sm">
      <button
        type="button"
        onClick={() => onChange(Math.max(1, Math.round(value) - 1))}
        aria-label="Fewer servings"
        className="flex size-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Minus className="size-3.5" />
      </button>
      <span className="min-w-10 px-1 text-center font-semibold tabular-nums">
        {Number.isInteger(value) ? value : value.toFixed(1)}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(99, Math.round(value) + 1))}
        aria-label="More servings"
        className="flex size-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}
