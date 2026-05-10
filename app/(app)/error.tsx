"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the error in the dev console / Sentry-like handler.
    // Production telemetry can hook in here later.
    console.error("[app] unhandled error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center px-4 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-7" />
      </div>
      <h1 className="mt-4 font-display text-2xl font-semibold">
        Something burned in the kitchen.
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        We hit an unexpected error rendering this page. You can try again, or
        head back to the feed.
      </p>
      {error.digest && (
        <p className="mt-3 text-[11px] text-muted-foreground/70 tabular-nums">
          ref: {error.digest}
        </p>
      )}
      <div className="mt-6 flex gap-2">
        <Button onClick={reset} className="gap-1.5">
          <RotateCw className="size-4" />
          Try again
        </Button>
        <Button render={<Link href="/feed" />} variant="outline">
          Back to feed
        </Button>
      </div>
    </div>
  );
}
