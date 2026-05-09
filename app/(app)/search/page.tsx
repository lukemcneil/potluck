import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

export default function SearchPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Search</h1>
      <p className="mt-1 text-muted-foreground">
        Find recipes by name, ingredient, cuisine, or tag.
      </p>

      <div className="relative mt-6">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search recipes..."
          className="h-11 pl-9"
          aria-label="Search recipes"
        />
      </div>

      <p className="mt-10 text-center text-sm text-muted-foreground">
        Search results will appear here once you&apos;ve added some recipes.
      </p>
    </div>
  );
}
