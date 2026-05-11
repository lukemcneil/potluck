import type { Metadata } from "next";
import Link from "next/link";
import { WifiOff, ChefHat } from "lucide-react";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Offline",
  description: "You're offline — recently visited recipes still work.",
  robots: { index: false, follow: false },
};

/**
 * Fallback page served by the service worker when a navigation fails
 * because the user is offline AND we don't have that specific URL
 * cached. Pages they've already visited are served from cache without
 * ever hitting this page.
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 py-16 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
        <WifiOff className="size-8" aria-hidden />
      </div>
      <h1 className="font-display text-2xl font-semibold tracking-tight">
        You&apos;re offline
      </h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Recipes you&apos;ve already opened still work — they&apos;re cached
        on your device. New pages need an internet connection.
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <Button render={<Link href="/feed" />} variant="outline" size="sm" className="gap-1.5">
          <ChefHat className="size-4" aria-hidden />
          Try the feed
        </Button>
        <Button render={<Link href="/cookbook" />} size="sm">
          Open my cookbook
        </Button>
      </div>
    </div>
  );
}
