import "server-only";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export async function requireSession(callbackUrl?: string) {
  const session = await auth();
  if (!session?.user?.id) {
    const params = new URLSearchParams();
    if (callbackUrl) params.set("callbackUrl", callbackUrl);
    redirect(`/signin${params.toString() ? `?${params.toString()}` : ""}`);
  }
  return session;
}
