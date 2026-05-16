"use client";

import { useCallback, useRef, useState } from "react";
import Image from "next/image";
import { Camera, ImagePlus, X, GripVertical, Loader2, Star, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PhotoRole } from "@/db/schema";

export type UploadedPhoto = {
  publicPath: string;
  width: number;
  height: number;
  placeholder: string;
  /**
   * Whether this photo is the recipe's visual identity (`cover`) or
   * original source material kept for verification (`source`). New
   * uploads default to `cover` so the picker behaves identically to
   * the pre-role version unless the caller tells us otherwise.
   */
  role?: PhotoRole;
};

type Props = {
  photos: UploadedPhoto[];
  onChange: (next: UploadedPhoto[]) => void;
  maxPhotos?: number;
  /** Trigger the camera capture by default (mobile). */
  defaultCamera?: boolean;
  /**
   * Show the per-photo role toggle (cover vs source). On by default —
   * pass `false` from surfaces where roles aren't useful (e.g. a
   * future avatar picker).
   */
  showRoleToggle?: boolean;
};

function roleOf(p: UploadedPhoto): PhotoRole {
  return p.role ?? "cover";
}

export function PhotoPicker({
  photos,
  onChange,
  maxPhotos = 8,
  defaultCamera = false,
  showRoleToggle = true,
}: Props) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const remaining = Math.max(0, maxPhotos - photos.length);
  const coverCount = photos.filter((p) => roleOf(p) === "cover").length;
  const sourceCount = photos.length - coverCount;

  const handleFiles = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files || files.length === 0) return;
      const list = Array.from(files).slice(0, remaining);
      if (list.length === 0) return;

      setUploading(true);
      setError(null);
      try {
        const formData = new FormData();
        list.forEach((file) => formData.append("files", file));

        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? `Upload failed (${res.status})`);
        }
        const data = (await res.json()) as { files: UploadedPhoto[] };
        // /api/upload doesn't know about roles, so freshly-uploaded
        // photos arrive role-less. Default them to `cover` here so
        // they show up as the visual identity unless the user flips
        // them — preserves the pre-role UX for the common case.
        const stamped: UploadedPhoto[] = data.files.map((f) => ({
          ...f,
          role: f.role ?? "cover",
        }));
        onChange([...photos, ...stamped]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
        if (cameraInputRef.current) cameraInputRef.current.value = "";
        if (libraryInputRef.current) libraryInputRef.current.value = "";
      }
    },
    [onChange, photos, remaining],
  );

  const removeAt = (index: number) => {
    onChange(photos.filter((_, i) => i !== index));
  };

  const moveLeft = (index: number) => {
    if (index === 0) return;
    const next = [...photos];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    onChange(next);
  };

  const moveRight = (index: number) => {
    if (index >= photos.length - 1) return;
    const next = [...photos];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    onChange(next);
  };

  const toggleRole = (index: number) => {
    const next = photos.map((p, i) =>
      i === index ? { ...p, role: roleOf(p) === "cover" ? "source" as const : "cover" as const } : p,
    );
    onChange(next);
  };

  return (
    <div>
      {/*
        These two file inputs are triggered programmatically by the
        visible Take/From-library buttons. We `aria-hidden` and
        `tabIndex={-1}` them so screen readers and keyboard users
        don't encounter unlabeled file pickers in the focus order.
      */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture={defaultCamera ? "environment" : undefined}
        multiple
        onChange={(e) => handleFiles(e.target.files)}
        className="sr-only"
        aria-hidden
        tabIndex={-1}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => handleFiles(e.target.files)}
        className="sr-only"
        aria-hidden
        tabIndex={-1}
      />

      {photos.length === 0 ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFiles(e.dataTransfer.files);
          }}
          className={cn(
            "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border bg-card/40 px-6 py-12 text-center transition-colors",
            dragOver && "border-primary bg-primary/5",
          )}
        >
          <p className="font-display text-lg font-semibold">Add recipe photos</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            Snap a recipe card, magazine page, or screenshot. Add up to{" "}
            {maxPhotos} images — we&apos;ll combine them into one recipe.
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <Button
              type="button"
              size="lg"
              onClick={() => cameraInputRef.current?.click()}
              disabled={uploading}
              className="gap-1.5"
            >
              {uploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Camera className="size-4" />
              )}
              Take photo
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              onClick={() => libraryInputRef.current?.click()}
              disabled={uploading}
              className="gap-1.5"
            >
              <ImagePlus className="size-4" />
              From library
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            On desktop: drag and drop images here.
          </p>
        </div>
      ) : (
        <>
          {showRoleToggle && (
            <p className="mb-2 text-xs text-muted-foreground">
              Tap{" "}
              <span className="rounded bg-primary/15 px-1 font-medium text-primary">
                Cover
              </span>{" "}
              or{" "}
              <span className="rounded bg-muted px-1 font-medium">Source</span>{" "}
              under a photo to choose whether it shows up as the recipe&apos;s
              hero image or stays hidden as a reference for later.
            </p>
          )}
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
            {photos.map((p, i) => {
              const role = roleOf(p);
              const isCover = role === "cover";
              return (
              <li key={p.publicPath} className="space-y-1">
                <div
                  className={cn(
                    "group relative aspect-square overflow-hidden rounded-xl bg-muted",
                    !isCover &&
                      "opacity-70 ring-1 ring-inset ring-border",
                  )}
                >
                  <Image
                    src={p.publicPath}
                    alt=""
                    fill
                    sizes="(max-width: 640px) 33vw, 200px"
                    className="object-cover"
                    placeholder="blur"
                    blurDataURL={p.placeholder}
                  />
                  <div className="absolute inset-x-1 top-1 flex justify-between">
                    <span className="rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {i + 1}
                    </span>
                    <button
                      type="button"
                      aria-label="Remove photo"
                      onClick={() => removeAt(i)}
                      className="flex size-6 items-center justify-center rounded-md bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                  <div className="absolute inset-x-1 bottom-1 flex justify-between gap-1">
                    <button
                      type="button"
                      aria-label="Move left"
                      onClick={() => moveLeft(i)}
                      disabled={i === 0}
                      className="flex size-6 items-center justify-center rounded-md bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <GripVertical className="size-3.5 -rotate-90" />
                    </button>
                    <button
                      type="button"
                      aria-label="Move right"
                      onClick={() => moveRight(i)}
                      disabled={i === photos.length - 1}
                      className="flex size-6 items-center justify-center rounded-md bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <GripVertical className="size-3.5 rotate-90" />
                    </button>
                  </div>
                </div>
                {showRoleToggle && (
                  <button
                    type="button"
                    onClick={() => toggleRole(i)}
                    aria-pressed={isCover}
                    aria-label={
                      isCover
                        ? "Photo is shown as a cover image. Click to make it source material instead."
                        : "Photo is hidden as source material. Click to make it a cover image instead."
                    }
                    title={
                      isCover
                        ? "Cover — shown as the recipe's hero. Click to demote to source."
                        : "Source — kept for reference, not shown as the hero. Click to promote to cover."
                    }
                    className={cn(
                      "flex w-full items-center justify-center gap-1 rounded-md px-1 py-1 text-[11px] font-medium transition",
                      isCover
                        ? "bg-primary/15 text-primary hover:bg-primary/25"
                        : "bg-muted text-muted-foreground hover:bg-muted/70",
                    )}
                  >
                    {isCover ? (
                      <Star className="size-3" aria-hidden />
                    ) : (
                      <FileText className="size-3" aria-hidden />
                    )}
                    {isCover ? "Cover" : "Source"}
                  </button>
                )}
              </li>
              );
            })}

            {remaining > 0 && (
              <li>
                <div className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border bg-card/40 p-2">
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={uploading}
                    className="flex flex-col items-center gap-1 text-muted-foreground hover:text-foreground"
                    aria-label="Add another photo"
                  >
                    {uploading ? (
                      <Loader2 className="size-5 animate-spin" />
                    ) : (
                      <Camera className="size-5" />
                    )}
                    <span className="text-[11px] font-medium">Add</span>
                  </button>
                </div>
              </li>
            )}
          </ul>

          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {photos.length} of {maxPhotos} photos
              {showRoleToggle && photos.length > 0 && (
                <>
                  {" \u2022 "}
                  {coverCount} cover{coverCount === 1 ? "" : "s"}, {sourceCount}{" "}
                  source
                </>
              )}
            </span>
            <button
              type="button"
              onClick={() => libraryInputRef.current?.click()}
              disabled={uploading || remaining === 0}
              className="underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add from library
            </button>
          </div>
        </>
      )}

      {error && (
        <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
