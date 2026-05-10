import Link from "next/link";
import { ChefHat } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function AppNotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center px-4 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-muted">
        <ChefHat className="size-7 text-muted-foreground" />
      </div>
      <h1 className="mt-4 font-display text-2xl font-semibold">
        We couldn&apos;t find that page.
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The recipe, profile, or collection you&apos;re looking for might be
        private, deleted, or just a typo away.
      </p>
      <div className="mt-6 flex gap-2">
        <Link href="/feed">
          <Button>Back to feed</Button>
        </Link>
        <Link href="/search">
          <Button variant="outline">Search</Button>
        </Link>
      </div>
    </div>
  );
}
