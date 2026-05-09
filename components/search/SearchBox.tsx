"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search as SearchIcon, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = {
  initialValue?: string;
  placeholder?: string;
  className?: string;
  /** ms to wait after typing before pushing to URL. */
  debounceMs?: number;
};

/**
 * Search box that drives `/search?q=...`. The page is RSC, so changing the
 * URL re-runs the server query and re-streams the results. We debounce the
 * URL push so we're not thrashing on every keystroke.
 */
export function SearchBox({
  initialValue = "",
  placeholder = "Search…",
  className,
  debounceMs = 200,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [value, setValue] = useState(initialValue);
  const [, startTransition] = useTransition();
  const lastPushed = useRef(initialValue);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep input in sync if the URL changes from elsewhere (e.g. Back button).
  useEffect(() => {
    const fromUrl = params.get("q") ?? "";
    if (fromUrl !== lastPushed.current) {
      setValue(fromUrl);
      lastPushed.current = fromUrl;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  function pushQuery(next: string) {
    if (next === lastPushed.current) return;
    lastPushed.current = next;

    const sp = new URLSearchParams(params.toString());
    if (next) sp.set("q", next);
    else sp.delete("q");
    const target = sp.toString() ? `${pathname}?${sp.toString()}` : pathname;
    startTransition(() => {
      router.replace(target, { scroll: false });
    });
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => pushQuery(next.trim()), debounceMs);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (timer.current) clearTimeout(timer.current);
    pushQuery(value.trim());
  }

  function clear() {
    setValue("");
    if (timer.current) clearTimeout(timer.current);
    pushQuery("");
  }

  return (
    <form onSubmit={onSubmit} className={cn("relative", className)} role="search">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={onChange}
        autoComplete="off"
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-11 pr-10 pl-9"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={clear}
          className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      )}
    </form>
  );
}
