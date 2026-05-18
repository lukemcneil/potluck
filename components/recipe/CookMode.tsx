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
import {
  formatIngredientPrefix,
  parseQuantity,
  pluralizeUnit,
  scaleQuantity,
  scaleStepText,
} from "@/lib/cooking/scale";
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

  // Servings scaler — same logic as the detail page's RecipeBody.
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

  // Screen wake lock — best-effort.
  //
  // Two non-obvious things about the Screen Wake Lock API that this
  // effect has to handle correctly:
  //
  //   1. The system AUTO-RELEASES the lock whenever the page goes
  //      hidden (tab switch, screen-off, foreground app change,
  //      iOS low-power mode kicking in, etc). The sentinel's
  //      `released` flag flips to true; the sentinel object itself
  //      stays around but is no longer doing anything.
  //
  //   2. To detect the auto-release you have to listen for the
  //      sentinel's `release` event. Previously this code only
  //      checked `wakeLockRef.current == null` on visibilitychange,
  //      which meant: first auto-release left a stale (released)
  //      sentinel in the ref, the next visibility-back check skipped
  //      the re-acquire, and the screen could time out for the rest
  //      of the cook session. This is the actual cook-mode bug.
  //
  // The fix: attach a `release` listener that clears the ref so the
  // visibilitychange handler can re-acquire. We ALSO double-check
  // `.released` on re-acquire as belt-and-suspenders for engines
  // that fail to fire the event (Safari has historically been
  // inconsistent here).
  useEffect(() => {
    let cancelled = false;

    async function acquire() {
      if (cancelled) return;
      const existing = wakeLockRef.current;
      if (existing && !existing.released) return;

      const nav = navigator as Navigator & {
        wakeLock?: { request(type: "screen"): Promise<WakeLockSentinel> };
      };
      if (!nav.wakeLock) return;
      try {
        const lock = await nav.wakeLock.request("screen");
        if (cancelled) {
          await lock.release().catch(() => {});
          return;
        }
        wakeLockRef.current = lock;
        lock.addEventListener("release", () => {
          // Clear the ref so the next visibilitychange (or any
          // future acquire() call) actually re-requests instead of
          // returning early. Only clear if it's still OUR lock —
          // a later acquire might have already replaced it.
          if (wakeLockRef.current === lock) {
            wakeLockRef.current = null;
          }
        });
      } catch {
        // Silently ignore — wake lock is a best-effort comfort,
        // not load-bearing. Common rejections: user is in iOS
        // low-power mode, or the document hasn't been interacted
        // with yet (cook mode is entered via tap so this is rare).
      }
    }

    void acquire();

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        // Always try to re-acquire on visibility-back. acquire()
        // internally short-circuits when we already hold a live
        // lock, so this is cheap when nothing changed.
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
  const currentStepBody = currentStep
    ? scaleStepText(currentStep.body, factor)
    : "";

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
          <Button
            render={<Link href={`/r/${recipe.id}`} />}
            variant="ghost"
            size="icon"
            aria-label="Exit cook mode"
          >
            <X className="size-5" />
          </Button>
        </div>
      </header>

      <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
        <aside className="max-h-[40vh] shrink-0 overflow-y-auto border-b border-border md:max-h-none md:w-80 md:border-r md:border-b-0">
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
                  const prefix = formatIngredientPrefix(
                    ing.scaledQuantity || ing.quantity,
                    ing.scaledUnit || ing.unit,
                    ing.name,
                  );
                  return (
                    <li key={ing.id}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
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
                          {prefix && <>{prefix} </>}
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
              <Button
                render={<Link href={`/r/${recipe.id}`} />}
                variant="outline"
                className="mt-4"
              >
                Back to recipe
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-1 flex-col px-6 py-8 sm:px-12 sm:py-12">
                <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
                  <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                    Step {stepIndex + 1} of {totalSteps}
                  </p>
                  <p className="mt-4 font-display text-2xl leading-snug sm:text-3xl">
                    {currentStepBody}
                  </p>

                  {totalSteps > 1 && (
                    <ol className="mt-8 hidden gap-2 sm:flex sm:flex-wrap">
                      {steps.map((s, i) => {
                        const isCurrent = i === stepIndex;
                        return (
                          <li key={s.id}>
                            <button
                              type="button"
                              onClick={() => setStepIndex(i)}
                              className={cn(
                                "flex size-8 items-center justify-center rounded-full text-xs font-semibold transition",
                                isCurrent
                                  ? "bg-primary text-primary-foreground"
                                  : doneSteps.has(i)
                                    ? "bg-primary/15 text-primary"
                                    : "bg-muted text-muted-foreground hover:bg-muted/70",
                              )}
                              aria-current={isCurrent ? "step" : undefined}
                              aria-label={`Go to step ${i + 1}${isCurrent ? " (current)" : ""}`}
                            >
                              {i + 1}
                            </button>
                          </li>
                        );
                      })}
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
  const display = Number.isInteger(value) ? value : value.toFixed(1);
  return (
    <div
      className="inline-flex items-center overflow-hidden rounded-full border border-border text-sm"
      role="group"
      aria-label={`Servings: ${display}`}
    >
      <button
        type="button"
        onClick={() => onChange(Math.max(1, Math.round(value) - 1))}
        aria-label="Fewer servings"
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
        onClick={() => onChange(Math.min(99, Math.round(value) + 1))}
        aria-label="More servings"
        className="flex size-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}
