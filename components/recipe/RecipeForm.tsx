"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Plus,
  Trash2,
  Loader2,
  Globe,
  Lock,
  EyeOff,
  X,
  ChevronUp,
  ChevronDown,
  CornerDownRight,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  recipeFormSchema,
  KNOWN_DIETS,
  type RecipeFormInput,
  type RecipeFormOutput,
} from "@/lib/validators";
import { MEAL_TYPES, VISIBILITY } from "@/db/schema";
import { cn } from "@/lib/utils";
import {
  createRecipeAction,
  updateRecipeAction,
} from "@/lib/actions/recipes";
import type { UploadedPhoto } from "@/components/upload/PhotoPicker";
import { PhotoPicker } from "@/components/upload/PhotoPicker";
import {
  ingredientNeedsReview,
  stepNeedsReview,
  type IngredientFlag,
  type StepFlag,
} from "@/lib/ai/review";
import { ReviewStrip } from "@/components/recipe/ReviewStrip";
import {
  ReviewSourcePane,
  type ReviewSource,
} from "@/components/recipe/ReviewSourcePane";

/**
 * Verification payload handed in by the AI-import flow. Each
 * `*Flags` array runs PARALLEL to the matching `initial.ingredients` /
 * `initial.steps` array — index N's flag belongs to row N at first
 * render. Once `useFieldArray` has run we re-key by stable row id so
 * the linkage survives reorders/inserts.
 */
export type RecipeFormVerification = {
  ingredientFlags: IngredientFlag[];
  stepFlags: StepFlag[];
  verificationFailed: boolean;
  source?: ReviewSource;
};

type Props =
  | {
      mode?: "create";
      initial?: Partial<RecipeFormInput>;
      initialPhotos?: UploadedPhoto[];
      verification?: RecipeFormVerification | null;
      /**
       * When true, install a `beforeunload` listener so closing the
       * tab / reloading / hitting the browser back button asks
       * "Leave site? Changes you made may not be saved." Suspended
       * automatically while the form is mid-submit so the redirect
       * to /r/[id] after a successful save doesn't trigger it. Use
       * this on the AI-import path where the user often thinks the
       * extraction step IS the save step and walks away too early.
       */
      warnBeforeLeave?: boolean;
    }
  | {
      mode: "edit";
      recipeId: string;
      initial?: Partial<RecipeFormInput>;
      initialPhotos?: UploadedPhoto[];
      verification?: RecipeFormVerification | null;
      warnBeforeLeave?: boolean;
    };

const DEFAULTS: RecipeFormInput = {
  title: "",
  description: "",
  notes: "",
  prepMinutes: null,
  cookMinutes: null,
  servings: "",
  mealType: null,
  cuisine: "",
  diets: [],
  tags: [],
  visibility: "public",
  kind: "structured",
  sourceUrl: null,
  ingredients: [{ position: 0, name: "" }],
  steps: [{ position: 0, body: "" }],
  photos: [],
};

export function RecipeForm(props: Props) {
  const mode = props.mode ?? "create";
  const initial = props.initial;
  const initialPhotos = props.initialPhotos ?? [];
  const verification = props.verification ?? null;
  const warnBeforeLeave = props.warnBeforeLeave ?? false;

  const [photos, setPhotos] = useState<UploadedPhoto[]>(initialPhotos);
  const [tagInput, setTagInput] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  /*
   * Browser-level "are you sure you want to leave?" guard. We only
   * install it when warnBeforeLeave is on (the AI-import flow opts in;
   * /r/[id]/edit doesn't because the original is already saved).
   *
   * Browsers ignore custom messages now — they show their own
   * generic "Leave site? Changes you may not be saved." prompt. That
   * generic prompt is exactly what we want: it interrupts the back
   * gesture / tab close / pull-to-refresh that the user's mom used
   * to abandon the import without realising she hadn't saved.
   *
   * Suspended while the form is mid-submit via the isPendingRef so
   * the server action's redirect to /r/[id] after a successful save
   * doesn't trip the warning. The ref pattern is needed because
   * `beforeunload` handlers are installed once and need to see the
   * current submitting state without re-binding on every render.
   */
  const isPendingRef = useRef(false);
  isPendingRef.current = isPending;
  useEffect(() => {
    if (!warnBeforeLeave) return;
    const handler = (event: BeforeUnloadEvent) => {
      if (isPendingRef.current) return;
      event.preventDefault();
      // Required by older Chromium / Safari to actually show the
      // confirmation. Modern browsers ignore the value itself.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [warnBeforeLeave]);

  const form = useForm<RecipeFormInput, unknown, RecipeFormOutput>({
    resolver: zodResolver(recipeFormSchema),
    defaultValues: {
      ...DEFAULTS,
      ...initial,
      ingredients:
        initial?.ingredients?.length
          ? initial.ingredients
          : DEFAULTS.ingredients,
      steps: initial?.steps?.length ? initial.steps : DEFAULTS.steps,
      diets: initial?.diets ?? [],
      tags: initial?.tags ?? [],
    },
  });

  const ingredients = useFieldArray({
    control: form.control,
    name: "ingredients",
  });
  const steps = useFieldArray({ control: form.control, name: "steps" });

  // === Review state =====================================================
  // The verification payload's flag arrays are POSITIONAL, but RHF can
  // reorder/insert/remove rows. We re-key the maps by the stable
  // `field.id` on the FIRST render, then track resolution by id from
  // there. Mutating refs during render is the official lazy-init
  // pattern (see React's `useRef` docs) — this runs exactly once per
  // mount because we guard on `flagsByIdRef.current`.
  const flagsByIdRef = useRef<{
    ingredient: Map<string, IngredientFlag>;
    step: Map<string, StepFlag>;
  } | null>(null);
  if (verification && flagsByIdRef.current == null) {
    const ingMap = new Map<string, IngredientFlag>();
    ingredients.fields.forEach((f, i) => {
      const flag = verification.ingredientFlags[i];
      if (flag) ingMap.set(f.id, flag);
    });
    const stepMap = new Map<string, StepFlag>();
    steps.fields.forEach((f, i) => {
      const flag = verification.stepFlags[i];
      if (flag) stepMap.set(f.id, flag);
    });
    flagsByIdRef.current = { ingredient: ingMap, step: stepMap };
  }

  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const markResolved = (id: string) => {
    setResolvedIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const ingredientFlagFor = (rowId: string): IngredientFlag | undefined =>
    flagsByIdRef.current?.ingredient.get(rowId);
  const stepFlagFor = (rowId: string): StepFlag | undefined =>
    flagsByIdRef.current?.step.get(rowId);

  const ingredientUnresolved = (rowId: string): boolean => {
    if (resolvedIds.has(rowId)) return false;
    const f = ingredientFlagFor(rowId);
    return !!f && ingredientNeedsReview(f);
  };
  const stepUnresolved = (rowId: string): boolean => {
    if (resolvedIds.has(rowId)) return false;
    const f = stepFlagFor(rowId);
    return !!f && stepNeedsReview(f);
  };

  // Counted on every render — the math is cheap and stays consistent
  // with whatever fields/resolved state currently exist.
  const unresolvedCount =
    ingredients.fields.filter((f) => ingredientUnresolved(f.id)).length +
    steps.fields.filter((f) => stepUnresolved(f.id)).length;
  const blockSave = verification != null && unresolvedCount > 0;

  // `useWatch` is the memoization-safe sibling of `form.watch()` —
  // React Compiler refuses to memoize components that call `watch()`
  // directly, so we route per-field subscriptions through `useWatch`.
  const watchedDiets = useWatch({ control: form.control, name: "diets" }) ?? [];
  const watchedTags = useWatch({ control: form.control, name: "tags" }) ?? [];
  const watchedVisibility = useWatch({
    control: form.control,
    name: "visibility",
  });

  const toggleDiet = (diet: string) => {
    const next = watchedDiets.includes(diet)
      ? watchedDiets.filter((d) => d !== diet)
      : [...watchedDiets, diet];
    form.setValue("diets", next, { shouldDirty: true });
  };

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (!t) return;
    if (watchedTags.includes(t)) {
      setTagInput("");
      return;
    }
    form.setValue("tags", [...watchedTags, t], { shouldDirty: true });
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    form.setValue(
      "tags",
      watchedTags.filter((t) => t !== tag),
      { shouldDirty: true },
    );
  };

  const onSubmit = form.handleSubmit((values) => {
    setSubmitError(null);
    const ingredientCount = values.ingredients?.length ?? 0;
    // `photos_only` is reserved for recipes with at least one COVER
    // photo and nothing structured. A source-only recipe (e.g. just
    // a paper card kept for reference) without ingredients would
    // otherwise show "photos only" on the detail page but have no
    // visible photos, which is confusing — keep it as the default
    // kind in that case.
    const coverPhotoCount = photos.filter(
      (p) => (p.role ?? "cover") === "cover",
    ).length;
    const payload: RecipeFormOutput = {
      ...values,
      photos: photos.map((p) => ({
        path: p.publicPath,
        role: p.role ?? "cover",
      })),
      kind:
        coverPhotoCount > 0 && ingredientCount === 0
          ? "photos_only"
          : values.kind,
    };

    const fd = new FormData();
    fd.set("payload", JSON.stringify(payload));

    startTransition(async () => {
      const result =
        mode === "edit"
          ? await updateRecipeAction(
              (props as { recipeId: string }).recipeId,
              {},
              fd,
            )
          : await createRecipeAction({}, fd);
      // server action redirects on success, so we only get here on error
      if (result?.error) {
        setSubmitError(result.error);
      }
    });
  });

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      {verification?.source && <ReviewSourcePane source={verification.source} />}

      {verification?.verificationFailed && (
        <p
          className="rounded-md border border-amber-300/40 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-300/30 dark:bg-amber-300/10 dark:text-amber-100"
          data-print="hide"
        >
          We couldn&apos;t double-check this extraction (verification pass
          unavailable). Please look the recipe over carefully before saving —
          quantities and units especially.
        </p>
      )}

      <section>
        <h2 className="font-display text-lg font-semibold">Photos</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Add up to 8 photos. Mark each one as a{" "}
          <span className="font-medium text-foreground">Cover</span> (shown as
          the recipe&apos;s hero) or{" "}
          <span className="font-medium text-foreground">Source</span> (kept
          for reference — paper recipe cards, magazine clippings — but hidden
          from the main view).
        </p>
        <div className="mt-3">
          <PhotoPicker
            photos={photos}
            onChange={setPhotos}
            maxPhotos={8}
            defaultCamera
          />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-display text-lg font-semibold">The basics</h2>

        <Field label="Title" error={form.formState.errors.title?.message}>
          <Input
            {...form.register("title")}
            placeholder="Grandma's Apple Pie"
            autoComplete="off"
            className="text-base sm:text-lg"
          />
        </Field>

        <Field
          label="Short description"
          hint="A line or two about the dish."
        >
          <Textarea
            {...form.register("description")}
            rows={2}
            placeholder="A flaky, buttery classic with cinnamon-spiced apples."
          />
        </Field>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Prep (min)">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              {...form.register("prepMinutes", {
                setValueAs: numericFieldSetter,
              })}
              placeholder="15"
            />
          </Field>
          <Field label="Cook (min)">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              {...form.register("cookMinutes", {
                setValueAs: numericFieldSetter,
              })}
              placeholder="45"
            />
          </Field>
          <Field label="Servings">
            <Input
              {...form.register("servings")}
              placeholder="6"
              autoComplete="off"
            />
          </Field>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">Ingredients</h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Add ingredient"
            onClick={() =>
              ingredients.append({
                position: ingredients.fields.length,
                name: "",
              })
            }
            className="gap-1"
          >
            <Plus className="size-4" />
            Add
          </Button>
        </div>

        <ul className="space-y-2">
          {ingredients.fields.map((field, i) => {
            const flag = ingredientFlagFor(field.id);
            const showStrip = flag && ingredientUnresolved(field.id);
            return (
              <li
                key={field.id}
                className={cn(
                  "space-y-2",
                  showStrip &&
                    "rounded-lg border border-amber-300/40 bg-amber-50/40 p-2 dark:bg-amber-300/5",
                )}
              >
                {showStrip && (
                  <IngredientReviewStrip
                    flag={flag}
                    current={
                      form.getValues(`ingredients.${i}`) ?? {
                        name: "",
                        quantity: null,
                        unit: null,
                      }
                    }
                    onResolve={() => markResolved(field.id)}
                    onPickCheck={(updates) => {
                      if (updates.quantity !== undefined) {
                        form.setValue(
                          `ingredients.${i}.quantity`,
                          updates.quantity,
                          { shouldDirty: true },
                        );
                      }
                      if (updates.unit !== undefined) {
                        form.setValue(`ingredients.${i}.unit`, updates.unit, {
                          shouldDirty: true,
                        });
                      }
                      markResolved(field.id);
                    }}
                    onRemove={() => ingredients.remove(i)}
                  />
                )}
                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-2">
                    <Input
                      {...form.register(`ingredients.${i}.quantity`)}
                      placeholder="1 1/2"
                      aria-label="Quantity"
                    />
                  </div>
                  <div className="col-span-3">
                    <Input
                      {...form.register(`ingredients.${i}.unit`)}
                      placeholder="cups"
                      aria-label="Unit"
                    />
                  </div>
                  <div className="col-span-6">
                    <Input
                      {...form.register(`ingredients.${i}.name`)}
                      placeholder="all-purpose flour"
                      aria-label="Name"
                    />
                  </div>
                  <div className="col-span-1 flex">
                    <button
                      type="button"
                      onClick={() => ingredients.remove(i)}
                      aria-label="Remove ingredient"
                      className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <div className="col-span-12">
                    <Input
                      {...form.register(`ingredients.${i}.note`)}
                      placeholder="optional note (sifted, melted, etc.)"
                      aria-label="Note"
                      className="text-xs"
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">Steps</h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Add step"
            onClick={() =>
              steps.append({ position: steps.fields.length, body: "" })
            }
            className="gap-1"
          >
            <Plus className="size-4" />
            Add
          </Button>
        </div>

        <ol className="space-y-2">
          {steps.fields.map((field, i) => {
            const flag = stepFlagFor(field.id);
            const showStrip = flag && stepUnresolved(field.id);
            const isFirst = i === 0;
            const isLast = i === steps.fields.length - 1;
            return (
              <li
                key={field.id}
                className={cn(
                  "space-y-2",
                  showStrip &&
                    "rounded-lg border border-amber-300/40 bg-amber-50/40 p-2 dark:bg-amber-300/5",
                )}
              >
                {showStrip && (
                  <StepReviewStrip
                    flag={flag}
                    onResolve={() => markResolved(field.id)}
                    onUseCheck={(text) => {
                      form.setValue(`steps.${i}.body`, text, {
                        shouldDirty: true,
                      });
                      markResolved(field.id);
                    }}
                    onRemove={() => steps.remove(i)}
                  />
                )}
                <div className="flex items-start gap-2">
                  <span className="mt-2 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                    {i + 1}
                  </span>
                  <Textarea
                    {...form.register(`steps.${i}.body`)}
                    placeholder="Describe the step..."
                    rows={2}
                    className="flex-1"
                  />
                  {/*
                    Per-step controls. Laid out as a 2x2 grid so the
                    column matches the textarea's `rows={2}` height
                    without inflating the row. All four buttons are
                    always visible (touch screens never fire :hover)
                    and size-8 (32 px) hits the iOS min tap target.
                    Insert-below + the chevrons together remove the
                    "must add at end and re-chevron upward" workflow.
                  */}
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      onClick={() => steps.move(i, i - 1)}
                      disabled={isFirst}
                      aria-label={`Move step ${i + 1} up`}
                      className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                    >
                      <ChevronUp className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => steps.move(i, i + 1)}
                      disabled={isLast}
                      aria-label={`Move step ${i + 1} down`}
                      className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                    >
                      <ChevronDown className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        steps.insert(i + 1, {
                          position: i + 1,
                          body: "",
                        })
                      }
                      aria-label={`Insert a new step after step ${i + 1}`}
                      title="Insert step below"
                      className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <CornerDownRight className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => steps.remove(i)}
                      aria-label={`Remove step ${i + 1}`}
                      className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-display text-lg font-semibold">Notes</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Anything that isn&apos;t an ingredient or step — tips,
            substitutions, story behind the recipe, &ldquo;Mom always doubled
            the garlic.&rdquo; Optional.
          </p>
        </div>
        <Textarea
          {...form.register("notes")}
          rows={5}
          placeholder={
            "Make-ahead: dough rests overnight in the fridge.\n" +
            "Sub: swap pecans for walnuts.\n" +
            "Best served warm with vanilla ice cream."
          }
        />
      </section>

      <section className="space-y-4">
        <h2 className="font-display text-lg font-semibold">Categorize</h2>

        <Field label="Meal type" hint="Helps people find this when filtering.">
          <select
            {...form.register("mealType")}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm capitalize focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <option value="">Choose one (optional)</option>
            {MEAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Cuisine">
          <Input
            {...form.register("cuisine")}
            placeholder="italian, thai, american..."
            autoComplete="off"
          />
        </Field>

        <div>
          <Label id="recipe-diets-label">Diets</Label>
          {/*
            Each chip is an independent toggle (you can pick any number),
            so they're checkboxes rather than radios. Without role +
            aria-checked screen readers just hear a row of unrelated
            buttons with no on/off state.
          */}
          <div
            role="group"
            aria-labelledby="recipe-diets-label"
            className="mt-2 flex flex-wrap gap-1.5"
          >
            {KNOWN_DIETS.map((diet) => {
              const on = watchedDiets.includes(diet);
              return (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  key={diet}
                  onClick={() => toggleDiet(diet)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium capitalize transition",
                    on
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {diet.replace("-", " ")}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <Label>Tags</Label>
          <p className="text-xs text-muted-foreground">
            One-word descriptors like &quot;weeknight&quot; or
            &quot;make-ahead&quot;. Press Enter to add.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {watchedTags.map((t) => (
              <Badge key={t} variant="secondary" className="gap-1 lowercase">
                #{t}
                <button
                  type="button"
                  onClick={() => removeTag(t)}
                  className="ml-0.5 rounded hover:bg-foreground/10"
                  aria-label={`Remove tag ${t}`}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag();
                }
              }}
              onBlur={addTag}
              placeholder="add tag..."
              className="h-7 w-32 text-xs"
              autoComplete="off"
            />
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold">Visibility</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {VISIBILITY.map((v) => (
            <label
              key={v}
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm transition",
                watchedVisibility === v
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/50",
              )}
            >
              <input
                type="radio"
                value={v}
                {...form.register("visibility")}
                className="sr-only"
              />
              <span className="mt-0.5">
                {v === "public" && <Globe className="size-4 text-primary" />}
                {v === "unlisted" && <EyeOff className="size-4 text-muted-foreground" />}
                {v === "private" && <Lock className="size-4 text-muted-foreground" />}
              </span>
              <span>
                <span className="block font-medium capitalize">{v}</span>
                <span className="block text-xs text-muted-foreground">
                  {v === "public" && "Shows in the feed and on your profile."}
                  {v === "unlisted" && "Only people with the link."}
                  {v === "private" && "Just you."}
                </span>
              </span>
            </label>
          ))}
        </div>
      </section>

      {submitError && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {submitError}
        </p>
      )}

      {/*
        Sticky save bar.

        On mobile we sit `bottom-20` to clear the BottomTabBar (which is
        ~64px tall plus its lifted +Add pill). On desktop we collapse to
        the bottom of the viewport.

        The bar uses a fully-opaque background plus a small fade-mask
        above so form content scrolling under it appears to dissolve
        instead of being half-readable behind a translucent strip.
      */}
      <div
        className={cn(
          "sticky bottom-20 z-10 -mx-4 flex items-center justify-between gap-2 bg-background px-4 py-3",
          "shadow-[0_-12px_24px_-16px_rgb(0_0_0/0.18)]",
          "before:pointer-events-none before:absolute before:inset-x-0 before:-top-6 before:h-6 before:bg-linear-to-t before:from-background before:to-transparent",
          "sm:bottom-0 sm:-mx-6 sm:px-6",
        )}
      >
        {/*
          Left-side urgency badge for AI-imported recipes. The banner
          at the top of the page is the loud version; this is the
          quiet reinforcement at the save button itself in case the
          user scrolled straight to the bottom without reading. We
          hide it entirely once a submit is in flight so the
          "Saving…" state isn't accompanied by "Not saved yet".
        */}
        {warnBeforeLeave && !isPending ? (
          <span
            aria-hidden
            className="flex items-center gap-1.5 text-xs font-medium text-primary"
          >
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
            Not saved yet
          </span>
        ) : (
          <span />
        )}
        <Button
          type="submit"
          size="lg"
          disabled={isPending || blockSave}
          className="gap-1.5 min-w-32"
        >
          {isPending && <Loader2 className="size-4 animate-spin" />}
          {saveButtonLabel(isPending, mode, blockSave, unresolvedCount)}
        </Button>
      </div>
    </form>
  );
}

function saveButtonLabel(
  isPending: boolean,
  mode: "create" | "edit",
  blockSave: boolean,
  unresolvedCount: number,
): string {
  if (isPending) return "Saving...";
  if (blockSave) {
    return `Save (${unresolvedCount} to verify first)`;
  }
  return mode === "edit" ? "Save changes" : "Save recipe";
}

/**
 * Per-row strip rendered above an ingredient when verification flagged
 * it. The action set depends on which sub-flag is set, in priority
 * order: injected (verifier added it) → mismatch (units/quantities
 * disagree) → onlyInOriginal (verifier didn't see it) → lowConfidence
 * (model self-doubt with no second opinion). Only ONE action group is
 * shown at a time so the affordance stays unambiguous.
 */
function IngredientReviewStrip({
  flag,
  current,
  onResolve,
  onPickCheck,
  onRemove,
}: {
  flag: IngredientFlag;
  current: { quantity?: string | null; unit?: string | null; name: string };
  onResolve: () => void;
  onPickCheck: (updates: { quantity?: string; unit?: string }) => void;
  onRemove: () => void;
}) {
  const reasons: string[] = [];
  if (flag.injected) reasons.push(flag.injected.reason);
  if (flag.mismatch) reasons.push(flag.mismatch.reason);
  if (flag.onlyInOriginal) reasons.push(flag.onlyInOriginal.reason);
  if (flag.lowConfidence && !flag.mismatch && !flag.injected) {
    reasons.push("The extractor flagged this row as low-confidence.");
  }

  if (flag.injected) {
    return (
      <ReviewStrip
        reasons={reasons}
        actions={[
          { label: "Add to recipe", onClick: onResolve },
          { label: "Skip", variant: "neutral", onClick: onRemove },
        ]}
      />
    );
  }
  if (flag.mismatch) {
    const m = flag.mismatch;
    const currentLabel = formatChooserLabel(current.quantity, current.unit);
    const checkLabel = formatChooserLabel(m.check.quantity, m.check.unit);
    // If the formatted labels collapse to the same string (e.g. both
    // empty), fall back to a single "Confirm" so we don't render two
    // identical-looking buttons.
    if (currentLabel === checkLabel) {
      return (
        <ReviewStrip
          reasons={reasons}
          actions={[{ label: "Confirm", onClick: onResolve }]}
        />
      );
    }
    return (
      <ReviewStrip
        reasons={reasons}
        actions={[
          { label: `Use \u201C${currentLabel}\u201D`, onClick: onResolve },
          {
            label: `Use \u201C${checkLabel}\u201D`,
            onClick: () =>
              onPickCheck({
                ...(m.fieldsDiffering.includes("quantity")
                  ? { quantity: m.check.quantity ?? "" }
                  : {}),
                ...(m.fieldsDiffering.includes("unit")
                  ? { unit: m.check.unit ?? "" }
                  : {}),
              }),
          },
        ]}
      />
    );
  }
  if (flag.onlyInOriginal) {
    return (
      <ReviewStrip
        reasons={reasons}
        actions={[
          { label: "Keep", onClick: onResolve },
          { label: "Remove", variant: "danger", onClick: onRemove },
        ]}
      />
    );
  }
  // lowConfidence-only fallback.
  return (
    <ReviewStrip
      reasons={reasons}
      actions={[{ label: "Confirm", onClick: onResolve }]}
    />
  );
}

function StepReviewStrip({
  flag,
  onResolve,
  onUseCheck,
  onRemove,
}: {
  flag: StepFlag;
  onResolve: () => void;
  onUseCheck: (text: string) => void;
  onRemove: () => void;
}) {
  const reasons: string[] = [];
  if (flag.injected) reasons.push(flag.injected.reason);
  if (flag.textDiverges) reasons.push(flag.textDiverges.reason);
  if (flag.onlyInOriginal) reasons.push(flag.onlyInOriginal.reason);
  if (flag.lowConfidence && !flag.textDiverges && !flag.injected) {
    reasons.push("The extractor flagged this step as low-confidence.");
  }

  if (flag.injected) {
    return (
      <ReviewStrip
        reasons={reasons}
        actions={[
          { label: "Add to recipe", onClick: onResolve },
          { label: "Skip", variant: "neutral", onClick: onRemove },
        ]}
      />
    );
  }
  if (flag.textDiverges) {
    const check = flag.textDiverges.check;
    return (
      <ReviewStrip
        reasons={reasons}
        actions={[
          { label: "Keep current", onClick: onResolve },
          {
            label: "Use verifier's reading",
            onClick: () => onUseCheck(check),
          },
        ]}
        hint={
          <span>
            Verifier read it as: &ldquo;
            {truncate(check, 140)}
            &rdquo;
          </span>
        }
      />
    );
  }
  if (flag.onlyInOriginal) {
    return (
      <ReviewStrip
        reasons={reasons}
        actions={[
          { label: "Keep", onClick: onResolve },
          { label: "Remove", variant: "danger", onClick: onRemove },
        ]}
      />
    );
  }
  return (
    <ReviewStrip
      reasons={reasons}
      actions={[{ label: "Confirm", onClick: onResolve }]}
    />
  );
}

function formatChooserLabel(
  quantity: string | null | undefined,
  unit: string | null | undefined,
): string {
  return [quantity, unit]
    .map((s) => (s ?? "").trim())
    .filter((s) => s !== "")
    .join(" ")
    .trim() || "(blank)";
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "\u2026";
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label>{label}</Label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-1.5">{children}</div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function numericFieldSetter(value: unknown): number | null {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
