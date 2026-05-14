"use client";

import { useState } from "react";
import { Share2, Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/**
 * Share-to-anywhere button. On mobile (iOS Safari, Android Chrome) we
 * call `navigator.share()` which pops the OS share sheet, so the user
 * can punt the recipe into Messages, WhatsApp, Mail, AirDrop, etc.
 *
 * On desktop browsers — which mostly don't implement Web Share — we
 * fall back to copying the URL to the clipboard with a sonner toast.
 * The same fallback also catches "user dismissed the share sheet"
 * (an `AbortError`) so we don't show a spurious error toast.
 *
 * We deliberately don't render this for private recipes — the link
 * 404s for anyone the owner isn't. The caller decides whether to
 * include the button at all based on `recipe.visibility`.
 */
export function ShareButton({
  title,
  description,
}: {
  title: string;
  description?: string | null;
}) {
  const [justCopied, setJustCopied] = useState(false);

  async function handleShare() {
    // `window.location.href` is the URL the user is actually looking
    // at right now (Cloudflare Tunnel, ngrok, prod domain — whatever).
    // No need to plumb AUTH_URL through to the client just for this.
    const url = window.location.href;

    const shareData: ShareData = {
      title,
      // Web Share concatenates text + url in most app contexts. A short
      // description gives Messages / Mail something to preview; empty
      // is fine if the recipe doesn't have one.
      text: description?.trim() ? description.trim() : undefined,
      url,
    };

    if (
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function" &&
      // `canShare` is the cleanest probe — some embedded browsers
      // expose `share` but reject `url` fields. When `canShare` is
      // missing (older Android Chrome), we still try `share()` and
      // catch the throw below.
      (typeof navigator.canShare !== "function" ||
        navigator.canShare(shareData))
    ) {
      try {
        await navigator.share(shareData);
        return;
      } catch (err) {
        // User cancelled the share sheet → silent no-op.
        if (err instanceof Error && err.name === "AbortError") return;
        // Anything else (permission denied in an iframe, app-not-found
        // for a specific intent) falls through to the clipboard copy
        // so the user still gets a usable result.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setJustCopied(true);
      toast.success("Link copied to clipboard");
      // Reset the icon after a beat so a second click feels responsive
      // rather than locked into the success state.
      setTimeout(() => setJustCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy the link. Try long-pressing the URL bar.");
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="gap-1.5"
      onClick={handleShare}
      aria-label={`Share ${title}`}
    >
      {justCopied ? (
        <Check className="size-3.5" />
      ) : (
        <Share2 className="size-3.5" />
      )}
      {justCopied ? "Copied" : "Share"}
    </Button>
  );
}
