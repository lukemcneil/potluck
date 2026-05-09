"use client";

import { useState } from "react";
import { Camera, ImagePlus, Link as LinkIcon, Pencil, ArrowLeft, Sparkles, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RecipeForm } from "@/components/recipe/RecipeForm";
import {
  PhotoPicker,
  type UploadedPhoto,
} from "@/components/upload/PhotoPicker";
import type { ExtractedRecipe } from "@/lib/validators";

type Stage =
  | { kind: "choose" }
  | { kind: "photos"; photos: UploadedPhoto[] }
  | { kind: "url" }
  | { kind: "extracting"; photos?: UploadedPhoto[]; url?: string }
  | {
      kind: "form";
      photos: UploadedPhoto[];
      prefill: Partial<RecipePrefill> | null;
      sourceUrl?: string | null;
    };

type RecipePrefill = {
  title: string;
  description: string | null;
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

export function AddRecipeFlow() {
  const [stage, setStage] = useState<Stage>({ kind: "choose" });
  const [extractError, setExtractError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");

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
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Extraction failed (${res.status})`);
      }
      const { recipe } = (await res.json()) as { recipe: ExtractedRecipe };
      setStage({
        kind: "form",
        photos,
        prefill: prefillFromExtraction(recipe),
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
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Extraction failed (${res.status})`);
      }
      const { recipe } = (await res.json()) as { recipe: ExtractedRecipe };
      setStage({
        kind: "form",
        photos: [],
        prefill: prefillFromExtraction(recipe),
        sourceUrl: url,
      });
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Extraction failed");
      setStage({ kind: "url" });
    }
  };

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
      <div>
        <BackButton onClick={() => setStage({ kind: "choose" })} />
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Paste a recipe URL
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          We&apos;ll fetch the page and let you review the parsed recipe.
        </p>

        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            const url = urlInput.trim();
            if (!url) return;
            startExtractionFromUrl(url);
          }}
        >
          <Label htmlFor="recipe-url" className="sr-only">
            Recipe URL
          </Label>
          <Input
            id="recipe-url"
            type="url"
            placeholder="https://www.bonappetit.com/recipe/..."
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            inputMode="url"
            autoFocus
            className="flex-1 text-base"
          />
          <Button type="submit" size="lg" className="gap-2">
            <Sparkles className="size-4" />
            Extract
          </Button>
        </form>

        {extractError && (
          <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {extractError}
          </p>
        )}
      </div>
    );
  }

  if (stage.kind === "extracting") {
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
          {stage.url
            ? "Fetching the page and parsing it. This usually takes 5–15 seconds."
            : `Looking at ${stage.photos?.length ?? 0} photo${(stage.photos?.length ?? 0) === 1 ? "" : "s"} and turning them into a recipe card. This usually takes 5–15 seconds.`}
        </p>
      </div>
    );
  }

  // stage.kind === "form"
  return (
    <div>
      <BackButton onClick={() => setStage({ kind: "choose" })} />
      <h1 className="font-display text-2xl font-semibold tracking-tight">
        Review &amp; save
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {stage.prefill
          ? "We filled this in for you. Tweak anything that's off, then save."
          : "Fill in your recipe."}
      </p>
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
        />
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
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="group flex w-full items-start gap-4 rounded-xl border border-border bg-card p-4 text-left transition hover:border-primary/40 hover:bg-card/80 active:scale-[0.99]"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{title}</h3>
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

function prefillFromExtraction(r: ExtractedRecipe): Partial<RecipePrefill> {
  return {
    title: r.title,
    description: r.description ?? null,
    prepMinutes: r.prepMinutes ?? null,
    cookMinutes: r.cookMinutes ?? null,
    servings: r.servings ?? null,
    mealType: r.mealType ?? null,
    cuisine: r.cuisine ?? null,
    diets: r.suggestedDiets ?? [],
    tags: r.suggestedTags ?? [],
    ingredients: r.ingredients.map((ing, i) => ({
      position: i,
      quantity: ing.quantity ?? null,
      unit: ing.unit ?? null,
      name: ing.name,
      note: ing.note ?? null,
    })),
    steps: r.steps.map((body, i) => ({ position: i, body })),
  };
}
