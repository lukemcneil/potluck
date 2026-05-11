"use client";

import { useEffect, useState, useTransition } from "react";
import { Bell, BellOff } from "lucide-react";
import { toast } from "sonner";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

/**
 * Push-notification opt-in / opt-out, slotted into the user-account
 * dropdown next to "Install Potluck".
 *
 * Behavior:
 *   - Hidden if Push API or Notification API isn't supported, OR if
 *     the server hasn't shipped a VAPID public key (treated as "push
 *     intentionally disabled" by the operator).
 *   - When unsubscribed: tap → `Notification.requestPermission` →
 *     `pushManager.subscribe` → POST `/api/push/subscribe`.
 *   - When subscribed: tap → unsubscribe locally → POST
 *     `/api/push/unsubscribe`.
 *
 * The component does its own fetches rather than going through a
 * server action because Push subscription objects can't survive the
 * server-action serialization (they include ArrayBuffers).
 */
export function EnableNotificationsItem() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [vapidKey, setVapidKey] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ok =
        typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window;
      if (!ok) {
        if (!cancelled) setSupported(false);
        return;
      }
      // Try to fetch the public key. If the operator hasn't configured
      // VAPID, treat the feature as unsupported.
      try {
        const res = await fetch("/api/push/public-key", { cache: "no-store" });
        const body = (await res.json()) as { key: string | null };
        if (cancelled) return;
        if (!body.key) {
          setSupported(false);
          return;
        }
        setVapidKey(body.key);
        setSupported(true);

        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (cancelled) return;
        setSubscribed(!!existing);
      } catch {
        if (!cancelled) setSupported(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function subscribe() {
    if (!vapidKey) return;
    startTransition(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          toast.message("You'll need to allow notifications first.");
          return;
        }
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });
        const json = sub.toJSON();
        const res = await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: json.endpoint,
            keys: json.keys,
            userAgent: navigator.userAgent,
          }),
        });
        if (!res.ok) throw new Error(`subscribe failed (${res.status})`);
        setSubscribed(true);
        toast.success("Notifications on. We'll ping you when something happens.");
      } catch (err) {
        console.error("[push.subscribe]", err);
        toast.error("Couldn't enable notifications.");
      }
    });
  }

  function unsubscribe() {
    startTransition(async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (existing) {
          const endpoint = existing.endpoint;
          await existing.unsubscribe();
          await fetch("/api/push/unsubscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint }),
          });
        }
        setSubscribed(false);
        toast.message("Notifications off.");
      } catch (err) {
        console.error("[push.unsubscribe]", err);
        toast.error("Couldn't turn off notifications.");
      }
    });
  }

  if (supported !== true) return null;
  if (subscribed === null) return null;

  return (
    <DropdownMenuItem
      onClick={(e) => {
        e.preventDefault();
        if (pending) return;
        if (subscribed) unsubscribe();
        else subscribe();
      }}
    >
      {subscribed ? (
        <>
          <BellOff className="mr-2 size-4" />
          Turn off notifications
        </>
      ) : (
        <>
          <Bell className="mr-2 size-4" />
          Enable notifications
        </>
      )}
    </DropdownMenuItem>
  );
}

/**
 * The browser's `applicationServerKey` wants a Uint8Array, but VAPID
 * public keys are exposed as URL-safe base64. Decode + re-pack.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  // Allocate against a plain ArrayBuffer (not SharedArrayBuffer) so the
  // result satisfies the `BufferSource` shape `pushManager.subscribe`
  // expects under TypeScript's strict DOM lib.
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}
