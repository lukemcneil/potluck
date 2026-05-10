import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ChefHat } from "lucide-react";

export const metadata: Metadata = {
  title: "Sign in",
};

type SearchParams = Promise<{ callbackUrl?: string }>;

export default async function SignInPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  const { callbackUrl } = await searchParams;

  if (session?.user) {
    redirect(callbackUrl ?? "/feed");
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-12">
      <Link href="/" className="flex items-center gap-2">
        <ChefHat className="size-7 text-primary" />
        <span className="font-display text-2xl font-semibold tracking-tight">
          Potluck
        </span>
      </Link>

      <div className="mt-10 w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h1 className="text-center font-display text-2xl font-semibold tracking-tight">
          Welcome to the table
        </h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Sign in to build your cookbook and share recipes with the people you cook for.
        </p>

        <form
          className="mt-6"
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: callbackUrl ?? "/feed" });
          }}
        >
          <Button type="submit" size="lg" className="w-full gap-2">
            <GoogleIcon />
            Continue with Google
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          By continuing you agree to be neighborly. Don&apos;t be a jerk in someone else&apos;s kitchen.
        </p>
      </div>

      <Link
        href="/feed"
        className="mt-8 text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        Just browsing? Look at the feed first
      </Link>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg
      className="size-4"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      aria-hidden
    >
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.5-5.9 7.7-11.3 7.7-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.7 1.1 7.8 3l5.7-5.7C34 5.1 29.3 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8c1.8-4.3 6-7.5 11.1-7.5 3 0 5.7 1.1 7.8 3l5.7-5.7C34 5.1 29.3 3 24 3 16.3 3 9.7 7.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 45c5.2 0 9.9-2 13.4-5.3l-6.2-5.2c-2 1.5-4.5 2.5-7.2 2.5-5.4 0-10-3.4-11.7-8.2l-6.5 5C9.5 40.5 16.2 45 24 45z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.7l6.2 5.2C40.9 36.7 45 31 45 24c0-1.2-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}
