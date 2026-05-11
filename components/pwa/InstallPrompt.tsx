"use client";

import { useEffect, useState } from "react";
import { Download, Share, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Persistent flag so we don't badger users who said no. */
const DISMISSED_KEY = "potluck.installPrompt.dismissedAt";
const DISMISS_FOR_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Lightweight install affordance. We:
 *   - Listen for `beforeinstallprompt` (Chromium / Android / desktop
 *     Chrome/Edge) and show a small banner that triggers the native
 *     install dialog when the user opts in.
 *   - On iOS Safari, where `beforeinstallprompt` doesn't exist, show
 *     a banner that opens an "Add to Home Screen" instructions sheet.
 *   - Hide entirely once the app is installed (`display-mode: standalone`)
 *     or after the user explicitly dismisses for ~2 weeks.
 */
export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showIosSheet, setShowIosSheet] = useState(false);
  const [variant, setVariant] = useState<"hidden" | "native" | "ios">("hidden");

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Already installed → never show.
    if (
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS-specific: navigator.standalone === true when launched from
      // home screen.
      (navigator as { standalone?: boolean }).standalone
    ) {
      return;
    }

    // Recently dismissed → don't pester.
    const dismissedAt = Number(localStorage.getItem(DISMISSED_KEY) ?? 0);
    if (dismissedAt && Date.now() - dismissedAt < DISMISS_FOR_MS) {
      return;
    }

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setVariant("native");
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);

    // iOS Safari: no beforeinstallprompt fires. Detect Safari on iOS/iPadOS
    // and offer the manual flow. Done in a microtask so the setState
    // happens after the effect commits (avoids the React 19 cascading-
    // renders lint and matches what React wants effects to look like).
    Promise.resolve().then(() => {
      const ua = navigator.userAgent;
      const isIosLike =
        /iPad|iPhone|iPod/.test(ua) ||
        // iPadOS reports as Mac with touch support
        (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
      const isSafari =
        /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
      if (isIosLike && isSafari) {
        setVariant((prev) => (prev === "hidden" ? "ios" : prev));
      }
    });

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    };
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    setVariant("hidden");
    setDeferredPrompt(null);
  }

  async function handleInstallClick() {
    if (variant === "ios") {
      setShowIosSheet(true);
      return;
    }
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (outcome === "dismissed") {
      // Treat as a soft dismiss so we don't immediately re-show on the
      // next page load.
      localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    }
    setVariant("hidden");
  }

  if (variant === "hidden") return null;

  return (
    <>
      <div
        className={cn(
          // Sits just above the bottom tab bar (z-40) but below sheets/
          // dialogs (z-50). On desktop it floats in the bottom-right.
          "fixed inset-x-3 bottom-20 z-40 sm:right-4 sm:left-auto sm:max-w-sm",
          "rounded-2xl border border-border bg-card text-card-foreground shadow-lg",
          "p-3 pr-2",
        )}
        role="dialog"
        aria-label="Install Potluck"
      >
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Download className="size-4" aria-hidden />
          </div>
          <div className="flex-1 text-sm">
            <p className="font-semibold">Install Potluck</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Add to your home screen so recipes work offline in the kitchen.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" onClick={handleInstallClick} className="h-8">
                {variant === "ios" ? "How to install" : "Install"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={dismiss}
                className="h-8 text-muted-foreground"
              >
                Not now
              </Button>
            </div>
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={dismiss}
            aria-label="Dismiss install prompt"
            className="-mt-1"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <Dialog open={showIosSheet} onOpenChange={setShowIosSheet}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Install Potluck on iPhone</DialogTitle>
            <DialogDescription>
              Safari doesn&apos;t have a one-tap install. Three quick steps:
            </DialogDescription>
          </DialogHeader>
          <ol className="list-decimal space-y-3 pl-5 text-sm">
            <li className="flex flex-col gap-1">
              <span>
                Tap the{" "}
                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 align-middle text-xs">
                  <Share className="size-3.5" aria-hidden /> Share
                </span>{" "}
                button at the bottom of Safari.
              </span>
            </li>
            <li className="flex flex-col gap-1">
              <span>
                Scroll down and choose{" "}
                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 align-middle text-xs">
                  <Plus className="size-3.5" aria-hidden /> Add to Home Screen
                </span>
                .
              </span>
            </li>
            <li>Tap <strong>Add</strong>. Potluck will live next to your other apps.</li>
          </ol>
          <DialogFooter>
            <Button onClick={() => setShowIosSheet(false)}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
