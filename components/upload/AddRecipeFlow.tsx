"use client";

import { useEffect, useRef, useState } from "react";
import {
  Camera,
  ImagePlus,
  Link as LinkIcon,
  Pencil,
  ArrowLeft,
  ArrowDown,
  Sparkles,
  Loader2,
  AlertTriangle,
  Clipboard,
  CheckCircle2,
  ClipboardPaste,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  RecipeForm,
  type RecipeFormVerification,
} from "@/components/recipe/RecipeForm";
import {
  PhotoPicker,
  type UploadedPhoto,
} from "@/components/upload/PhotoPicker";
import type { ExtractedRecipe } from "@/lib/validators";
import type { Discrepancy } from "@/lib/ai/discrepancies";
import { buildReviewPayload } from "@/lib/ai/review";

type ExtractionCost = {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  totalUsd: number;
};

type ExtractionSpend = {
  totalUsd: number;
  capUsd: number | null;
  /** True when the API downgraded this call to gpt-4o-mini. */
  degraded?: boolean;
};

type AiSpendSnapshot = {
  totalUsd: number;
  capUsd: number | null;
};

/**
 * Shape of the JSON returned by `POST /api/extract` (success or
 * 422 no-recipe). `verificationFailed` is true when the second-pass
 * verification call timed out / errored / disagreed about whether
 * the input was a recipe — the importer still gets the primary
 * recipe but with a banner noting the safety net was off.
 */
type ExtractApiResponse = {
  recipe?: ExtractedRecipe;
  discrepancies?: Discrepancy[];
  verificationFailed?: boolean;
  cost?: ExtractionCost;
  spend?: ExtractionSpend;
  /**
   * URL imports only — server-side scraped + normalized + persisted
   * photos pulled from og:image / JSON-LD Recipe.image on the source
   * page. Already shaped as `UploadedPhoto` so we can hand them
   * straight to RecipeForm as `initialPhotos`. Defaults to empty array
   * (no images found, or scrape failed silently).
   */
  photos?: UploadedPhoto[];
  error?: string;
  reason?: string;
};

const SOFT_CAP_FRACTION = 2 / 3;

function isApproachingCap(spend: AiSpendSnapshot | null): boolean {
  if (!spend || spend.capUsd == null) return false;
  return spend.totalUsd >= spend.capUsd * SOFT_CAP_FRACTION;
}

type Stage =
  | { kind: "choose" }
  | { kind: "photos"; photos: UploadedPhoto[] }
  | { kind: "url" }
  | { kind: "text" }
  | {
      kind: "extracting";
      photos?: UploadedPhoto[];
      url?: string;
      // Pasted-text imports: not displayed (it can be very long) but
      // we keep a flag so the loading copy can mention "your note".
      fromText?: boolean;
    }
  | {
      kind: "form";
      photos: UploadedPhoto[];
      prefill: Partial<RecipePrefill> | null;
      sourceUrl?: string | null;
      cost?: ExtractionCost | null;
      verification?: RecipeFormVerification | null;
    };

type RecipePrefill = {
  title: string;
  description: string | null;
  notes: string | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  servings: string | null;
  mealType: string | null;
  cuisine: string | null;
  diets: string[];
  tags: string[];
  ingredients: Array<{
    position: number;
    quantity: string | null;
    unit: string | null;
    name: string;
    note: string | null;
  }>;
  steps: Array<{ position: number; body: string }>;
};

/**
 * Payload handed in from the Web Share Target (`/share-receive`)
 * route. The page parses search params and forwards them here so the
 * flow can skip the "choose" stage and jump straight into the right
 * extractor.
 */
export type ShareIntent =
  | { kind: "url"; url: string; title?: string | null }
  | { kind: "photo-ids"; ids: string[]; title?: string | null }
  | { kind: "text"; text?: string | null; title?: string | null };

export function AddRecipeFlow({
  initialAiSpend = null,
  initialShare = null,
}: {
  initialAiSpend?: AiSpendSnapshot | null;
  initialShare?: ShareIntent | null;
}) {
  const [stage, setStage] = useState<Stage>({ kind: "choose" });
  const [extractError, setExtractError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [textInput, setTextInput] = useState("");
  const [aiSpend, setAiSpend] = useState<AiSpendSnapshot | null>(initialAiSpend);

  // Refresh spend snapshot on mount in case the user already made other
  // extractions in this session before opening /add. Cheap and cached
  // by the browser if the user navigates away and back.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai/spend", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AiSpendSnapshot | null) => {
        if (!cancelled && data) setAiSpend(data);
      })
      .catch(() => {
        // Non-fatal — we'll just skip the warning.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function applySpendUpdate(spend: ExtractionSpend | null | undefined) {
    if (!spend) return;
    setAiSpend({ totalUsd: spend.totalUsd, capUsd: spend.capUsd });
  }

  const startExtractionFromPhotos = async (photos: UploadedPhoto[]) => {
    setExtractError(null);
    setStage({ kind: "extracting", photos });
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "imageIds",
          imageIds: photos.map((p) => idFromPath(p.publicPath)),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as ExtractApiResponse;
      applySpendUpdate(body.spend);
      if (res.status === 422 && body?.error === "no_recipe_found") {
        setExtractError(
          body.reason
            ? `We couldn't find a recipe in those photos. ${body.reason} You can try different photos, or "Just save the photos" / "Type it in" instead.`
            : "We couldn't find a recipe in those photos. You can try different photos, or save them as-is.",
        );
        setStage({ kind: "photos", photos });
        return;
      }
      if (!res.ok || !body.recipe) {
        throw new Error(body?.error ?? `Extraction failed (${res.status})`);
      }
      const review = buildReviewPayload(body.recipe, body.discrepancies ?? []);
      // Photos handed to the AI extractor are by definition source
      // material — the user is OCRing them, not framing them as the
      // recipe's beauty shot. Stamp them as `source` here so they
      // don't quietly become the recipe's cover. The Cover/Source
      // toggle on each thumbnail in PhotoPicker still lets the user
      // promote any of them to cover before saving.
      const photosAsSource: UploadedPhoto[] = photos.map((p) => ({
        ...p,
        role: "source",
      }));
      setStage({
        kind: "form",
        photos: photosAsSource,
        prefill: prefillFromReview(body.recipe, review),
        cost: body.cost ?? null,
        verification: {
          ingredientFlags: review.ingredientFlags,
          stepFlags: review.stepFlags,
          verificationFailed: !!body.verificationFailed,
          source: { kind: "photos", photos },
        },
      });
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Extraction failed");
      setStage({ kind: "photos", photos });
    }
  };

  const startExtractionFromUrl = async (url: string) => {
    setExtractError(null);
    setStage({ kind: "extracting", url });
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "url", url }),
      });
      const body = (await res.json().catch(() => ({}))) as ExtractApiResponse;
      applySpendUpdate(body.spend);
      if (res.status === 422 && body?.error === "no_recipe_found") {
        setExtractError(
          body.reason
            ? `We couldn't find a recipe at that URL. ${body.reason} Double-check the link, or use "Type it in" instead.`
            : "We couldn't find a recipe at that URL. Double-check the link, or type it in by hand.",
        );
        setStage({ kind: "url" });
        return;
      }
      if (!res.ok || !body.recipe) {
        throw new Error(body?.error ?? `Extraction failed (${res.status})`);
      }
      const review = buildReviewPayload(body.recipe, body.discrepancies ?? []);
      // Photos scraped from the source page (og:image / JSON-LD
      // Recipe.image) are by definition the page's "beauty shot" of
      // the dish — exactly what users want as the recipe's cover.
      // Stamp them as `cover` so they show up in the carousel
      // immediately, matching the default behavior of direct
      // PhotoPicker uploads. The user can still demote any of them
      // to `source` via the toggle.
      const importedPhotos: UploadedPhoto[] = (body.photos ?? []).map((p) => ({
        ...p,
        role: "cover",
      }));
      setStage({
        kind: "form",
        photos: importedPhotos,
        prefill: prefillFromReview(body.recipe, review),
        sourceUrl: url,
        cost: body.cost ?? null,
        verification: {
          ingredientFlags: review.ingredientFlags,
          stepFlags: review.stepFlags,
          verificationFailed: !!body.verificationFailed,
          source: { kind: "url", url },
        },
      });
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Extraction failed");
      setStage({ kind: "url" });
    }
  };

  const startExtractionFromText = async (text: string) => {
    setExtractError(null);
    setStage({ kind: "extracting", fromText: true });
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "text", text }),
      });
      const body = (await res.json().catch(() => ({}))) as ExtractApiResponse;
      applySpendUpdate(body.spend);
      if (res.status === 422 && body?.error === "no_recipe_found") {
        setExtractError(
          body.reason
            ? `We couldn't find a recipe in that text. ${body.reason} Try a longer note, or use "Type it in" instead.`
            : "We couldn't find a recipe in that text. Try a longer note, or type it in by hand.",
        );
        setStage({ kind: "text" });
        return;
      }
      if (!res.ok || !body.recipe) {
        throw new Error(body?.error ?? `Extraction failed (${res.status})`);
      }
      const review = buildReviewPayload(body.recipe, body.discrepancies ?? []);
      setStage({
        kind: "form",
        photos: [],
        prefill: prefillFromReview(body.recipe, review),
        cost: body.cost ?? null,
        verification: {
          ingredientFlags: review.ingredientFlags,
          stepFlags: review.stepFlags,
          verificationFailed: !!body.verificationFailed,
          source: { kind: "text", text },
        },
      });
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Extraction failed");
      setStage({ kind: "text" });
    }
  };

  // Web Share Target hand-off: if the page seeded us with an intent,
  // skip the choose tile and jump straight into the appropriate
  // extractor. Declared after `startExtractionFrom*` so React Compiler
  // can prove the references are stable at the call sites below.
  //
  // Every setState here is deferred to a microtask so React 19's
  // `set-state-in-effect` lint doesn't yell at us — these flips are
  // legitimately a "synchronize from a one-shot URL parameter" effect,
  // not a cascading-render footgun.
  useEffect(() => {
    if (!initialShare) return;
    queueMicrotask(() => {
      if (initialShare.kind === "url") {
        const u = initialShare.url.trim();
        if (!u) return;
        setUrlInput(u);
        void startExtractionFromUrl(u);
        return;
      }
      if (initialShare.kind === "photo-ids" && initialShare.ids.length > 0) {
        const ids = initialShare.ids;
        void (async () => {
          setStage({ kind: "extracting", photos: [] });
          try {
            const res = await fetch(
              `/api/uploads/meta?ids=${encodeURIComponent(ids.join(","))}`,
              { cache: "no-store" },
            );
            const body = (await res.json()) as { files?: UploadedPhoto[] };
            const photos = body.files ?? [];
            if (photos.length === 0) {
              setExtractError(
                "We couldn't find those shared photos — try sharing again.",
              );
              setStage({ kind: "photos", photos: [] });
              return;
            }
            await startExtractionFromPhotos(photos);
          } catch {
            setExtractError(
              "Couldn't load the shared photos. Try opening the share again.",
            );
            setStage({ kind: "photos", photos: [] });
          }
        })();
        return;
      }
      if (initialShare.kind === "text") {
        // Text-only share: when the text looks like a URL share (a
        // recipe link copied to the share sheet), strip it out and
        // hop into the URL flow. Otherwise this is a real note —
        // route into the paste-text flow with the body prefilled
        // so the user can hit Extract immediately.
        const text = initialShare.text?.trim() ?? "";
        if (!text) return;
        const urlMatch = text.match(/https?:\/\/[^\s<>"]+/i);
        const looksLikeJustALinkShare = urlMatch && text.length - urlMatch[0].length < 50;
        if (looksLikeJustALinkShare) {
          setUrlInput(urlMatch[0]);
          setStage({ kind: "url" });
          return;
        }
        setTextInput(text);
        setStage({ kind: "text" });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialShare]);

  if (stage.kind === "choose") {
    return (
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Add a recipe
        </h1>
        <p className="mt-1 text-muted-foreground">
          How would you like to start? You can edit anything before you save.
        </p>

        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          <Tile
            icon={<Camera className="size-5" />}
            title="Take or pick photos"
            body="Snap a recipe card, magazine page, or screenshot. AI fills in the details."
            badge="Magic"
            onClick={() => setStage({ kind: "photos", photos: [] })}
          />
          <Tile
            icon={<LinkIcon className="size-5" />}
            title="Paste a URL"
            body="Drop a link to a recipe online and we'll bring it home for you."
            badge="Magic"
            onClick={() => setStage({ kind: "url" })}
          />
          <Tile
            icon={<ClipboardPaste className="size-5" />}
            title="Paste recipe text"
            body="From a phone note, email, or message. AI turns it into a tidy card."
            badge="Magic"
            onClick={() => setStage({ kind: "text" })}
          />
          <Tile
            icon={<Pencil className="size-5" />}
            title="Type it in"
            body="Old-school. Add a recipe by hand if you want full control."
            onClick={() =>
              setStage({ kind: "form", photos: [], prefill: null })
            }
          />
          <Tile
            icon={<ImagePlus className="size-5" />}
            title="Photos only"
            body="Just save the photos with no parsing. Great for handwritten cards you want to preserve as-is."
            onClick={() => setStage({ kind: "photos", photos: [] })}
          />
        </ul>
      </div>
    );
  }

  if (stage.kind === "photos") {
    return (
      <div>
        <BackButton onClick={() => setStage({ kind: "choose" })} />
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Add photos
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {stage.photos.length === 0
            ? "Snap a photo, pick from your library, or drag & drop."
            : `${stage.photos.length} photo${stage.photos.length === 1 ? "" : "s"} ready. Add more or continue.`}
        </p>

        <div className="mt-4">
          <PhotoPicker
            photos={stage.photos}
            onChange={(photos) => setStage({ kind: "photos", photos })}
            maxPhotos={8}
            defaultCamera
          />
        </div>

        {stage.photos.length > 0 && (
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <Button
              size="lg"
              onClick={() => startExtractionFromPhotos(stage.photos)}
              className="flex-1 gap-2"
            >
              <Sparkles className="size-4" />
              Extract recipe with AI
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() =>
                setStage({
                  kind: "form",
                  photos: stage.photos,
                  prefill: null,
                })
              }
              className="flex-1"
            >
              Just save the photos
            </Button>
          </div>
        )}

        {extractError && (
          <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {extractError}
          </p>
        )}
      </div>
    );
  }

  if (stage.kind === "url") {
    return (
      <UrlStage
        urlInput={urlInput}
        setUrlInput={setUrlInput}
        onSubmit={(u) => startExtractionFromUrl(u)}
        onBack={() => setStage({ kind: "choose" })}
        extractError={extractError}
      />
    );
  }

  if (stage.kind === "text") {
    return (
      <TextStage
        textInput={textInput}
        setTextInput={setTextInput}
        onSubmit={(t) => startExtractionFromText(t)}
        onBack={() => setStage({ kind: "choose" })}
        extractError={extractError}
        onSwitchToUrl={(url) => {
          setExtractError(null);
          setUrlInput(url);
          setTextInput("");
          setStage({ kind: "url" });
        }}
      />
    );
  }

  if (stage.kind === "extracting") {
    const approaching = isApproachingCap(aiSpend);
    const isImageExtraction = (stage.photos?.length ?? 0) > 0;
    const loadingCopy = stage.url
      ? "Fetching the page and reading it carefully. Usually 15–45 seconds — richer pages with long headnotes take a bit more."
      : stage.fromText
        ? "Reading your note and turning it into a recipe card. Usually 10–20 seconds."
        : `Looking at ${stage.photos?.length ?? 0} photo${(stage.photos?.length ?? 0) === 1 ? "" : "s"} and turning them into a recipe card. Usually 10–20 seconds.`;
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="relative">
          <div className="size-12 rounded-full bg-primary/10" />
          <Loader2 className="absolute inset-0 m-auto size-6 animate-spin text-primary" />
        </div>
        <h2 className="mt-6 font-display text-xl font-semibold">
          Reading the recipe...
        </h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {loadingCopy}
        </p>
        {approaching && aiSpend?.capUsd != null && (
          <div className="mt-6 inline-flex max-w-sm items-start gap-2 rounded-lg border border-amber-300/50 bg-amber-50 px-3 py-2 text-left text-xs text-amber-900 dark:border-amber-300/30 dark:bg-amber-300/10 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              You&apos;ve used {formatCapUsd(aiSpend.totalUsd)} of your{" "}
              {formatCapUsd(aiSpend.capUsd)} monthly AI budget.{" "}
              {isImageExtraction
                ? "We'll switch to a cheaper model for the rest of this month."
                : "URL extraction already uses the cheaper model — no impact."}
            </span>
          </div>
        )}
      </div>
    );
  }

  // stage.kind === "form"
  const isPrefilled = !!stage.prefill;
  /*
   * The user's mom imported a recipe, the form filled in for her,
   * and she hit the browser back button because she thought the
   * extraction step WAS the save step. The recipe was thrown away
   * silently. So when we're on the form stage of an AI-import flow
   * (i.e. prefill is present), confirm before letting the user
   * abandon the in-page back button. The RecipeForm separately
   * installs a `beforeunload` listener to catch the browser back
   * button / tab close / pull-to-refresh below.
   */
  const handleBackFromForm = () => {
    if (
      isPrefilled &&
      !window.confirm(
        "Discard this imported recipe? You haven't saved it yet, and going back will throw away what we extracted.",
      )
    ) {
      return;
    }
    setStage({ kind: "choose" });
  };

  return (
    <div>
      <BackButton onClick={handleBackFromForm} />
      <h1 className="font-display text-2xl font-semibold tracking-tight">
        {isPrefilled ? "Almost done — review and save" : "Add a recipe"}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {isPrefilled
          ? "We extracted this for you. Look it over, fix anything off, then tap Save at the bottom to add it to your cookbook."
          : "Fill in your recipe."}
      </p>
      {isPrefilled && <ImportSuccessBanner />}
      {stage.cost && (
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
          <span aria-hidden>{"\u2728"}</span>
          AI extraction cost: {formatExtractionCost(stage.cost.totalUsd)}{" "}
          <span className="text-muted-foreground/60">
            ({stage.cost.modelId}, {stage.cost.inputTokens + stage.cost.outputTokens} tokens)
          </span>
        </p>
      )}
      <div className="mt-6">
        <RecipeForm
          initialPhotos={stage.photos}
          initial={
            stage.prefill
              ? ({
                  ...stage.prefill,
                  sourceUrl: stage.sourceUrl ?? null,
                } as never)
              : { sourceUrl: stage.sourceUrl ?? null } as never
          }
          verification={stage.verification ?? null}
          warnBeforeLeave={isPrefilled}
        />
      </div>
    </div>
  );
}

/**
 * Loud, hard-to-miss banner shown above the import-prefilled recipe
 * form. The user's mom would tap Magic Snap, see the extracted
 * recipe, and walk away — she thought she was done at that point.
 * This banner is the answer: bright primary tint, explicit "you
 * still need to save", and a literal arrow pointing down at the
 * Save button. It's not graceful, and that's the point.
 */
function ImportSuccessBanner() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-4 flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/10 p-4 text-sm shadow-sm"
    >
      <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
      <div className="flex-1">
        <p className="font-semibold text-foreground">
          Recipe extracted — one more step!
        </p>
        <p className="mt-1 text-foreground/80">
          Scroll through to make sure everything looks right, then tap{" "}
          <span className="inline-flex items-center gap-1 rounded-md bg-primary/20 px-1.5 py-0.5 font-medium text-primary">
            Save recipe
          </span>{" "}
          at the bottom. <strong>Nothing is saved yet</strong> — if you leave
          this page now you&apos;ll lose the import.
        </p>
        <p className="mt-2 inline-flex items-center gap-1 text-xs text-primary/80">
          <ArrowDown className="size-3.5 animate-bounce" aria-hidden />
          Save button is at the bottom of the form
        </p>
      </div>
    </div>
  );
}

function Tile({
  icon,
  title,
  body,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  badge?: string;
  onClick: () => void;
}) {
  // Without an aria-label the button announces as one smushed string
  // ("Take or pick photosMagicSnap a recipe card…"). The label keeps
  // each chunk separated by punctuation when read aloud.
  const ariaLabel = badge
    ? `${title}. ${badge}. ${body}`
    : `${title}. ${body}`;
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        className="group flex w-full items-start gap-4 rounded-xl border border-border bg-card p-4 text-left transition hover:border-primary/40 hover:bg-card/80 active:scale-[0.99]"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">{title}</h2>
            {badge && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-primary uppercase">
                {badge}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{body}</p>
        </div>
      </button>
    </li>
  );
}

/**
 * URL stage of the add-recipe flow.
 *
 * Lifted into its own component so we can hang the Web Share Target
 * remediation logic — a one-tap "Paste link" button that reads the
 * clipboard — off of it without bloating the parent. Why this exists:
 *
 *   - Android: Web Share Target works once installed, BUT only if the
 *     PWA was installed from the production domain. Stale dev-mode
 *     installs route the share intent to localhost (the URL the
 *     manifest was bound to at install time). The fix for that is to
 *     uninstall + reinstall from the prod URL — but until then, paste
 *     is the next-best workaround.
 *   - iOS Safari: Web Share Target API is NOT IMPLEMENTED and won't
 *     be soon. Sharing TO a PWA on iOS happens via "Copy" in the
 *     share sheet → open the PWA → paste. There's no way around
 *     this until Apple adds the API.
 *
 * So the universal cross-platform sharing path is: copy the URL on
 * the source page, open Potluck, tap "Paste link". One affordance,
 * works everywhere.
 *
 * We DO NOT auto-read the clipboard on mount: iOS Safari shows a
 * "Paste from clipboard?" permission popup the first time it's
 * called, and surprising the user with that on every visit to /add
 * is hostile. The explicit button (a user gesture) keeps the popup
 * scoped to "I asked for this".
 */
function UrlStage({
  urlInput,
  setUrlInput,
  onSubmit,
  onBack,
  extractError,
}: {
  urlInput: string;
  setUrlInput: (next: string) => void;
  onSubmit: (url: string) => void;
  onBack: () => void;
  extractError: string | null;
}) {
  const [pasteError, setPasteError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const tryPaste = async () => {
    setPasteError(null);
    // Clipboard API is HTTPS-only and gated behind a user gesture
    // on most browsers; this whole handler runs in a click, which
    // satisfies that. If it isn't available at all (older Safari,
    // file: URLs, etc) we fall back to focusing the input and
    // letting the OS native paste UI handle it.
    const cb = navigator.clipboard;
    if (!cb || typeof cb.readText !== "function") {
      inputRef.current?.focus();
      setPasteError(
        "Your browser blocks reading the clipboard here. Long-press the field and tap Paste.",
      );
      return;
    }
    try {
      const text = (await cb.readText()).trim();
      if (!text) {
        setPasteError("Your clipboard is empty.");
        return;
      }
      // Be lenient: accept any string that contains an http(s) URL,
      // not just strings that are JUST a URL. Some apps copy "Check
      // out this recipe: https://... — yum!"; we just pull the
      // first URL out.
      const match = text.match(/https?:\/\/[^\s<>"]+/i);
      const url = match ? match[0] : text;
      if (!/^https?:\/\//i.test(url)) {
        setPasteError(
          "That doesn't look like a recipe URL — paste a link starting with http or https.",
        );
        return;
      }
      setUrlInput(url);
      onSubmit(url);
    } catch {
      // Permission denied or some other failure. iOS Safari's
      // permission popup throws when dismissed; that's fine.
      inputRef.current?.focus();
      setPasteError(
        "Couldn't read your clipboard. Long-press the field and tap Paste, or paste manually.",
      );
    }
  };

  return (
    <div>
      <BackButton onClick={onBack} />
      <h1 className="font-display text-2xl font-semibold tracking-tight">
        Import a recipe from a URL
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        On iPhone in particular, the share sheet won&apos;t add Potluck — copy
        the link from Safari, then tap below.
      </p>

      {/*
        Primary CTA is "Paste from clipboard": one tap on mobile, no
        keyboard juggling. Bumped to a full-width primary button on
        every breakpoint because the most common iOS path is
        copy-link → switch apps → paste, and the URL field below is
        the explicit fallback (typed link, share-sheet hand-off, or
        a clipboard permission that the browser refuses).
      */}
      <Button
        type="button"
        onClick={tryPaste}
        size="lg"
        className="mt-4 w-full gap-2"
      >
        <Clipboard className="size-5" />
        Paste link from clipboard
      </Button>

      <div className="mt-6 flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground">
        <span aria-hidden className="h-px flex-1 bg-border" />
        <span>or paste manually</span>
        <span aria-hidden className="h-px flex-1 bg-border" />
      </div>

      <form
        className="mt-4 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          const url = urlInput.trim();
          if (!url) return;
          onSubmit(url);
        }}
      >
        <Label htmlFor="recipe-url" className="sr-only">
          Recipe URL
        </Label>
        <Input
          ref={inputRef}
          id="recipe-url"
          type="url"
          placeholder="https://www.bonappetit.com/recipe/..."
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          inputMode="url"
          className="flex-1 text-base"
        />
        <Button type="submit" size="lg" variant="outline" className="gap-2">
          <Sparkles className="size-4" />
          Extract
        </Button>
      </form>

      {(extractError || pasteError) && (
        <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {extractError ?? pasteError}
        </p>
      )}
    </div>
  );
}

/**
 * "Paste recipe text" import flow. Mirrors the URL stage's primary-CTA
 * pattern: paste-from-clipboard is the headline action, with a textarea
 * underneath as the manual fallback. The minimum-length constraint
 * (mirrored on the server-side zod schema) keeps obvious "yum" pastes
 * from burning a model call.
 */
const MIN_TEXT_CHARS = 20;
const MAX_TEXT_CHARS = 50_000;

/**
 * Detect the "user pasted a recipe link into the text box" case.
 * Returns the matched URL when the paste is essentially just a link
 * (the URL plus less than ~50 characters of preamble / trailing
 * chatter like "Check this out: https://… yum"), otherwise null. The
 * threshold matches the share-intent text-routing heuristic so the
 * two affordances feel consistent.
 *
 * Pure for testability and to keep the component body readable.
 */
function detectLinkPaste(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/https?:\/\/[^\s<>"]+/i);
  if (!match) return null;
  const url = match[0];
  if (trimmed.length - url.length >= 50) return null;
  return url;
}

function TextStage({
  textInput,
  setTextInput,
  onSubmit,
  onBack,
  extractError,
  onSwitchToUrl,
}: {
  textInput: string;
  setTextInput: (next: string) => void;
  onSubmit: (text: string) => void;
  onBack: () => void;
  extractError: string | null;
  onSwitchToUrl: (url: string) => void;
}) {
  const [pasteError, setPasteError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const tryPaste = async () => {
    setPasteError(null);
    const cb = navigator.clipboard;
    if (!cb || typeof cb.readText !== "function") {
      textareaRef.current?.focus();
      setPasteError(
        "Your browser blocks reading the clipboard here. Long-press the box below and tap Paste.",
      );
      return;
    }
    try {
      const text = (await cb.readText()).trim();
      if (!text) {
        setPasteError("Your clipboard is empty.");
        return;
      }
      // Cap at the server-side max so we don't even try sending an
      // over-budget paste — the user gets a clear UI affordance
      // instead of a 400.
      const capped =
        text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
      setTextInput(capped);
      // Focus + scroll into view so the user sees what got pasted
      // before deciding to extract. Auto-submitting felt overeager —
      // pasted text is often messy (preamble, signatures), so we let
      // the user clean it up first.
      textareaRef.current?.focus();
    } catch {
      textareaRef.current?.focus();
      setPasteError(
        "Couldn't read your clipboard. Long-press the box below and tap Paste.",
      );
    }
  };

  const trimmed = textInput.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_TEXT_CHARS;
  const linkPaste = detectLinkPaste(textInput);
  // A bare URL is not a recipe note — running it through the text
  // extractor wastes a model call AND skips the URL fetch's
  // schema-org / og:image niceties. Block submit and offer the
  // one-tap escape hatch instead.
  const canSubmit = trimmed.length >= MIN_TEXT_CHARS && !linkPaste;

  return (
    <div>
      <BackButton onClick={onBack} />
      <h1 className="font-display text-2xl font-semibold tracking-tight">
        Paste a recipe from a note
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Paste a recipe you wrote in your phone&apos;s notes app, an email, a
        message, or anywhere else. AI will turn it into a clean card.
      </p>

      <Button
        type="button"
        onClick={tryPaste}
        size="lg"
        className="mt-4 w-full gap-2"
      >
        <Clipboard className="size-5" />
        Paste from clipboard
      </Button>

      <div className="mt-6 flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground">
        <span aria-hidden className="h-px flex-1 bg-border" />
        <span>or paste manually</span>
        <span aria-hidden className="h-px flex-1 bg-border" />
      </div>

      <form
        className="mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit) return;
          onSubmit(trimmed);
        }}
      >
        <Label htmlFor="recipe-text" className="sr-only">
          Recipe text
        </Label>
        <Textarea
          ref={textareaRef}
          id="recipe-text"
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          placeholder={
            "Mom's chocolate chip cookies\n\n2 1/4 cups flour\n1 tsp baking soda\n1 cup butter\n...\n\nMix the dry ingredients..."
          }
          rows={10}
          maxLength={MAX_TEXT_CHARS}
          className="min-h-[240px] text-base"
        />
        <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {tooShort
              ? `Add a bit more — at least ${MIN_TEXT_CHARS} characters.`
              : trimmed.length > 0
                ? `${trimmed.length.toLocaleString()} characters`
                : "Tip: include ingredients and instructions for the best result."}
          </span>
          {trimmed.length > 0 && (
            <button
              type="button"
              className="text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => {
                setTextInput("");
                textareaRef.current?.focus();
              }}
            >
              Clear
            </button>
          )}
        </div>
        {linkPaste && (
          <div
            role="status"
            className="mt-3 flex flex-col gap-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:flex-row sm:items-center dark:border-amber-300/30 dark:bg-amber-300/10 dark:text-amber-100"
          >
            <span className="flex-1">
              That looks like a link, not a written recipe. Import it from
              the URL instead — it&apos;s faster and pulls the page&apos;s
              hero image.
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onSwitchToUrl(linkPaste)}
              className="gap-2 self-start sm:self-auto"
            >
              <LinkIcon className="size-4" />
              Switch to URL import
            </Button>
          </div>
        )}

        <Button
          type="submit"
          size="lg"
          variant="outline"
          className="mt-3 w-full gap-2"
          disabled={!canSubmit}
        >
          <Sparkles className="size-4" />
          Extract recipe with AI
        </Button>
      </form>

      {(extractError || pasteError) && (
        <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {extractError ?? pasteError}
        </p>
      )}
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      Back
    </button>
  );
}

function idFromPath(publicPath: string): string {
  const filename = publicPath.split("/").pop() ?? "";
  return filename.includes(".") ? filename.slice(0, filename.lastIndexOf(".")) : filename;
}

/**
 * Tiny formatter for the "this extraction cost X" hint in the review
 * step. Renders in cents when sub-dollar so users see "0.7\u00a2" instead
 * of "$0.007".
 */
function formatExtractionCost(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  const cents = usd * 100;
  if (cents >= 1) return `${cents.toFixed(1)}\u00a2`;
  return `<0.1\u00a2`;
}

/**
 * "$2.00" / "$0.43" — used in the cap-warning banner. Always two decimal
 * places so the figures line up with what the profile shows.
 */
function formatCapUsd(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/**
 * Build form prefill from the recipe + spliced {@link ReviewPayload}.
 * The payload's `ingredients` and `steps` already include
 * verifier-added rows in place (with their `IngredientFlag.injected` /
 * `StepFlag.injected` set), which means the form's row indices match
 * the flag arrays positionally on first render — exactly what
 * `RecipeForm` relies on to re-key the flag maps by RHF row id.
 */
type ReviewPayload = ReturnType<typeof buildReviewPayload>;
function prefillFromReview(
  recipe: ExtractedRecipe,
  review: ReviewPayload,
): Partial<RecipePrefill> {
  return {
    title: recipe.title,
    description: recipe.description ?? null,
    notes: recipe.notes ?? null,
    prepMinutes: recipe.prepMinutes ?? null,
    cookMinutes: recipe.cookMinutes ?? null,
    servings: recipe.servings ?? null,
    mealType: recipe.mealType ?? null,
    cuisine: recipe.cuisine ?? null,
    diets: recipe.suggestedDiets ?? [],
    tags: recipe.suggestedTags ?? [],
    ingredients: review.ingredients.map((ing, i) => ({
      position: i,
      quantity: ing.quantity,
      unit: ing.unit,
      name: ing.name,
      note: ing.note,
    })),
    steps: review.steps.map((s, i) => ({ position: i, body: s.body })),
  };
}
