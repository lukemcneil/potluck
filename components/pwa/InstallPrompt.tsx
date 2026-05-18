"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Download, Share, Plus, X, MoreVertical } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** Persistent flag so we don't badger users who said no. */
const DISMISSED_KEY = "potluck.installPrompt.dismissedAt";
const DISMISS_FOR_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Platform = "android" | "ios" | "desktop" | "other";

type InstallContextValue = {
  /** True when launched from the home screen — hide all install affordances. */
  isStandalone: boolean;
  /** Best-guess platform; drives which instructions we show. */
  platform: Platform;
  /** True when Chrome's deferred prompt is available for one-tap install. */
  canPrompt: boolean;
  /** Open the platform-appropriate flow: native dialog or instructions sheet. */
  open: () => void;
  /** Mark "not now"; suppresses both banner and menu badge for ~2 weeks. */
  dismiss: () => void;
  /** True when the user soft-dismissed; affects banner only. */
  dismissed: boolean;
};

const InstallContext = createContext<InstallContextValue | null>(null);

/**
 * Provider that owns the deferred prompt event and platform detection.
 * Mount once, near the top of the app, so the banner and any "Install
 * app" menu entry can read the same state.
 */
export function InstallPromptProvider({ children }: { children: ReactNode }) {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [platform, setPlatform] = useState<Platform>("other");
  const [dismissed, setDismissed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Defer the platform / dismissed detection so the setState happens
    // outside the effect body — keeps React 19 happy and avoids the
    // cascading-renders lint without an eslint-disable.
    Promise.resolve().then(() => {
      setIsStandalone(
        window.matchMedia("(display-mode: standalone)").matches ||
          (navigator as { standalone?: boolean }).standalone === true,
      );

      const dismissedAt = Number(localStorage.getItem(DISMISSED_KEY) ?? 0);
      if (dismissedAt && Date.now() - dismissedAt < DISMISS_FOR_MS) {
        setDismissed(true);
      }

      setPlatform(detectPlatform());
    });

    const onBeforeInstallPrompt = (event: Event) => {
      // Stash the event so we can fire `.prompt()` from a click later.
      // Without preventDefault, Chrome may show its own mini-infobar.
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const value = useMemo<InstallContextValue>(() => {
    return {
      isStandalone,
      platform,
      canPrompt: deferredPrompt != null,
      dismissed,
      dismiss: () => {
        try {
          localStorage.setItem(DISMISSED_KEY, String(Date.now()));
        } catch {
          /* private mode etc. — best effort */
        }
        setDismissed(true);
      },
      open: () => {
        // Android / desktop Chrome path with a stashed prompt → fire it.
        if (deferredPrompt) {
          deferredPrompt
            .prompt()
            .then(() => deferredPrompt.userChoice)
            .then(({ outcome }) => {
              if (outcome === "dismissed") {
                try {
                  localStorage.setItem(DISMISSED_KEY, String(Date.now()));
                } catch {
                  /* ignore */
                }
                setDismissed(true);
              }
              setDeferredPrompt(null);
            })
            .catch(() => {
              // The user closed the dialog or browser refused — fall back
              // to the manual instructions so they're not stuck.
              setDialogOpen(true);
            });
          return;
        }
        // No deferred prompt → show platform instructions.
        setDialogOpen(true);
      },
    };
  }, [deferredPrompt, dismissed, isStandalone, platform]);

  return (
    <InstallContext.Provider value={value}>
      {children}
      <InstallInstructionsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        platform={platform}
      />
    </InstallContext.Provider>
  );
}

function useInstallContext(): InstallContextValue {
  const ctx = useContext(InstallContext);
  if (!ctx) {
    // Render-anywhere fallback: the install affordances become a no-op
    // when the provider isn't mounted (e.g. on /signin, /offline) so
    // nothing crashes if a future page forgets it.
    return {
      isStandalone: true,
      platform: "other",
      canPrompt: false,
      dismissed: true,
      open: () => {},
      dismiss: () => {},
    };
  }
  return ctx;
}

/**
 * Floating banner above the bottom tab bar. Only shows when:
 *   - not running standalone (i.e. not already installed), AND
 *   - we have a deferred prompt to fire OR we're on iOS (instructions).
 *
 * For dev/desktop and Android-without-an-engagement-prompt we keep the
 * floating banner quiet and rely on the menu entry — no point pestering
 * the user with a banner that doesn't lead anywhere clean.
 */
export function InstallPromptBanner() {
  const { isStandalone, platform, canPrompt, dismissed, open, dismiss } =
    useInstallContext();

  const showBanner =
    !isStandalone && !dismissed && (canPrompt || platform === "ios");

  if (!showBanner) return null;

  return (
    <div
      className={cn(
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
            <Button size="sm" onClick={open} className="h-8">
              {canPrompt ? "Install" : "How to install"}
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
  );
}

/**
 * Drop-in section for the account menu. Bundles its own separator so
 * dropping it into a menu doesn't leave orphan dividers when the app
 * is already installed (in which case the whole section disappears).
 *
 * Always shows the menu entry when the app isn't installed — even when
 * Chrome hasn't fired the deferred prompt yet — because the click
 * falls back to the platform instructions sheet.
 */
export function InstallMenuItem() {
  const { isStandalone, canPrompt, open } = useInstallContext();
  if (isStandalone) return null;
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        // Base UI's Menu fires onClick/onSelect from a non-button render
        // tree, so a plain onClick is the simplest hook.
        onClick={(e) => {
          e.preventDefault();
          open();
        }}
      >
        <Download className="size-4 text-muted-foreground" aria-hidden />
        <span className="flex-1">Install app</span>
        {canPrompt && (
          <span className="text-[10px] font-semibold tracking-wide text-primary uppercase">
            Ready
          </span>
        )}
      </DropdownMenuItem>
    </>
  );
}

/**
 * Modal with platform-specific install instructions. Shown when the
 * user explicitly asks "how do I install this?" and Chrome's deferred
 * prompt isn't available (iOS Safari, low-engagement Android, dev mode
 * over a tunnel, desktop Firefox, etc).
 */
function InstallInstructionsDialog({
  open,
  onOpenChange,
  platform,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  platform: Platform;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Install Potluck</DialogTitle>
          <DialogDescription>
            Add Potluck to your home screen so recipes work offline and the
            app opens without browser chrome.
          </DialogDescription>
        </DialogHeader>

        {platform === "ios" ? <IosInstructions /> : null}
        {platform === "android" ? <AndroidInstructions /> : null}
        {(platform === "desktop" || platform === "other") && (
          <DesktopInstructions />
        )}

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IosInstructions() {
  return (
    <>
      <ol className="list-decimal space-y-3 pl-5 text-sm">
        <li>
          Tap the{" "}
          <Chip>
            <Share className="size-3.5" aria-hidden /> Share
          </Chip>{" "}
          button at the bottom of Safari.
        </li>
        <li>
          Scroll down and choose{" "}
          <Chip>
            <Plus className="size-3.5" aria-hidden /> Add to Home Screen
          </Chip>
          .
        </li>
        <li>
          Tap <strong>Add</strong>. Potluck will live next to your other apps.
        </li>
      </ol>

      {/*
        iOS Safari doesn't implement the Web Share Target API — there's
        no "Share to Potluck" entry in the share sheet on iPhone, and
        Apple hasn't shipped support for it. The realistic flow is
        copy-the-URL-then-paste, which the URL stage in /add now has a
        one-tap button for. Calling it out here so iOS users aren't
        left wondering why "share to Potluck" doesn't exist.
      */}
      <div className="mt-4 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">
          Sharing recipes to Potluck on iPhone
        </p>
        <p className="mt-1">
          Safari doesn&apos;t support &ldquo;Share to Potluck&rdquo; the way
          Android does. To import a recipe from a website: tap{" "}
          <strong>Share &rarr; Copy</strong> in Safari, open Potluck, tap{" "}
          <strong>Paste a URL</strong>, then tap{" "}
          <strong>Paste link from clipboard</strong>.
        </p>
      </div>
    </>
  );
}

function AndroidInstructions() {
  return (
    <>
      <ol className="list-decimal space-y-3 pl-5 text-sm">
        <li>
          Tap the{" "}
          <Chip>
            <MoreVertical className="size-3.5" aria-hidden /> menu
          </Chip>{" "}
          button in the top-right of Chrome.
        </li>
        <li>
          Choose <strong>Install app</strong> (or{" "}
          <strong>Add to Home screen</strong> on older Chrome versions).
        </li>
        <li>
          Confirm. Potluck will appear in your launcher just like a normal app.
        </li>
        <li className="text-muted-foreground">
          If you don&apos;t see <em>Install app</em> in the menu, Chrome may
          still be waiting for &ldquo;engagement&rdquo; — try opening a few
          recipes and revisit this dialog.
        </li>
      </ol>

      {/*
        Android Web Share Target works once installed — BUT the install
        binds the manifest to whatever URL was being served when the
        user installed. If the user installed from a dev server (e.g.
        http://localhost:3000 or a stale ngrok URL), the share intent
        opens THAT URL, not the production one — which is the
        "shared to Potluck and it tried to open localhost" failure
        mode. Once an install is wrong, no client-side trick can fix
        it; the only path is uninstall + reinstall.
      */}
      <div className="mt-4 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">
          Sharing recipes to Potluck on Android
        </p>
        <p className="mt-1">
          Once installed, &ldquo;Share to Potluck&rdquo; will appear in any
          app&apos;s share sheet. If sharing opens a broken page (e.g. a
          localhost URL), uninstall the old shortcut from your home screen
          and install again from{" "}
          <span className="font-mono">{getInstallHost()}</span> — the
          install gets pinned to the URL you used at install time.
        </p>
      </div>
    </>
  );
}

/**
 * Best-effort host name for the "install from this URL" hint in the
 * Android sharing diagnostic. Falls back to a placeholder during SSR.
 */
function getInstallHost(): string {
  if (typeof window === "undefined") return "this page";
  return window.location.host;
}

function DesktopInstructions() {
  return (
    <ol className="list-decimal space-y-3 pl-5 text-sm">
      <li>
        In Chrome / Edge: look for the{" "}
        <Chip>
          <Download className="size-3.5" aria-hidden /> install
        </Chip>{" "}
        icon at the right edge of the address bar.
      </li>
      <li>
        Or open the browser menu and pick{" "}
        <strong>Install Potluck&hellip;</strong>.
      </li>
      <li className="text-muted-foreground">
        Firefox and Safari on macOS don&apos;t support installing web apps
        from the URL bar.
      </li>
    </ol>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 align-middle text-xs">
      {children}
    </span>
  );
}

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  const isIosLike =
    /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  if (isIosLike) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Macintosh|Windows|Linux|CrOS/.test(ua)) return "desktop";
  return "other";
}
