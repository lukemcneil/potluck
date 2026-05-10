"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useMemo, useTransition } from "react";
import { ChevronDown, X, Filter } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MEAL_TYPES, type MealType } from "@/db/schema";
import { KNOWN_DIETS } from "@/lib/validators";
import { cn } from "@/lib/utils";

const TIME_PRESETS: Array<{ value: number; label: string }> = [
  { value: 15, label: "≤ 15 min" },
  { value: 30, label: "≤ 30 min" },
  { value: 45, label: "≤ 45 min" },
  { value: 60, label: "≤ 1 hr" },
];

type Props = {
  /** Distinct cuisines to show in the cuisine dropdown. */
  cuisines: string[];
  /** Optional class for the wrapping row. */
  className?: string;
};

export function FilterChips({ cuisines, className }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const meal = (params.get("meal") || "") as MealType | "";
  const cuisine = (params.get("cuisine") || "").toLowerCase();
  const dietParam = params.get("diet") || "";
  const diets = useMemo(
    () => (dietParam ? dietParam.split(",").filter(Boolean) : []),
    [dietParam],
  );
  const maxStr = params.get("max");
  const max = maxStr ? Number(maxStr) : null;

  const update = (mutator: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    mutator(next);
    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  };

  const clearAll = () => {
    update((next) => {
      next.delete("meal");
      next.delete("cuisine");
      next.delete("diet");
      next.delete("max");
    });
  };

  const setMeal = (value: string) => {
    update((next) => {
      if (value) next.set("meal", value);
      else next.delete("meal");
    });
  };

  const setCuisine = (value: string) => {
    update((next) => {
      if (value) next.set("cuisine", value);
      else next.delete("cuisine");
    });
  };

  const toggleDiet = (diet: string) => {
    update((next) => {
      const current = new Set(diets);
      if (current.has(diet)) current.delete(diet);
      else current.add(diet);
      const list = Array.from(current);
      if (list.length === 0) next.delete("diet");
      else next.set("diet", list.join(","));
    });
  };

  const setMax = (value: number | null) => {
    update((next) => {
      if (value == null) next.delete("max");
      else next.set("max", String(value));
    });
  };

  const activeCount =
    (meal ? 1 : 0) + (cuisine ? 1 : 0) + diets.length + (max ? 1 : 0);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2",
        isPending && "opacity-60",
        className,
      )}
      aria-label="Filters"
    >
      <span className="hidden items-center gap-1 text-xs font-medium text-muted-foreground sm:inline-flex">
        <Filter className="size-3.5" />
        Filters
      </span>

      <FilterPill
        active={!!meal}
        label={meal ? cap(meal) : "Meal"}
        onClear={meal ? () => setMeal("") : undefined}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>Meal type</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={meal || "__any__"}
            onValueChange={(v) => setMeal(v === "__any__" ? "" : v)}
          >
            <DropdownMenuRadioItem value="__any__">Any</DropdownMenuRadioItem>
            {MEAL_TYPES.map((m) => (
              <DropdownMenuRadioItem key={m} value={m} className="capitalize">
                {m}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </FilterPill>

      <FilterPill
        active={!!cuisine}
        label={cuisine ? cap(cuisine) : "Cuisine"}
        onClear={cuisine ? () => setCuisine("") : undefined}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>Cuisine</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={cuisine || "__any__"}
            onValueChange={(v) => setCuisine(v === "__any__" ? "" : v)}
          >
            <DropdownMenuRadioItem value="__any__">Any</DropdownMenuRadioItem>
            {cuisines.length === 0 && (
              <DropdownMenuItem disabled>No cuisines yet</DropdownMenuItem>
            )}
            {cuisines.map((c) => (
              <DropdownMenuRadioItem key={c} value={c} className="capitalize">
                {c}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </FilterPill>

      <FilterPill
        active={diets.length > 0}
        label={
          diets.length === 0
            ? "Diet"
            : diets.length === 1
              ? cap(diets[0].replace("-", " "))
              : `Diets · ${diets.length}`
        }
        onClear={diets.length > 0 ? () => update((n) => n.delete("diet")) : undefined}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>Diet</DropdownMenuLabel>
          {KNOWN_DIETS.map((d) => (
            <DropdownMenuCheckboxItem
              key={d}
              checked={diets.includes(d)}
              onCheckedChange={() => toggleDiet(d)}
              onSelect={(e) => e.preventDefault()}
              className="capitalize"
            >
              {d.replace("-", " ")}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </FilterPill>

      <FilterPill
        active={max != null}
        label={max ? `≤ ${max} min` : "Time"}
        onClear={max != null ? () => setMax(null) : undefined}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>Total time</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={max ? String(max) : "__any__"}
            onValueChange={(v) => setMax(v === "__any__" ? null : Number(v))}
          >
            <DropdownMenuRadioItem value="__any__">Any</DropdownMenuRadioItem>
            {TIME_PRESETS.map((p) => (
              <DropdownMenuRadioItem key={p.value} value={String(p.value)}>
                {p.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </FilterPill>

      {activeCount > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={clearAll}
          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          Clear all
        </Button>
      )}
    </div>
  );
}

function FilterPill({
  active,
  label,
  onClear,
  children,
}: {
  active: boolean;
  label: string;
  onClear?: () => void;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <div
        className={cn(
          "inline-flex items-center gap-0 rounded-full border text-xs font-medium transition",
          active
            ? "border-primary/40 bg-primary/10 text-primary"
            : "border-border text-foreground/80 hover:bg-muted",
        )}
      >
        <DropdownMenuTrigger
          className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span>{label}</span>
          <ChevronDown className="size-3.5 opacity-70" />
        </DropdownMenuTrigger>
        {active && onClear && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            aria-label={`Clear ${label}`}
            className="-ml-0.5 mr-1 flex size-5 items-center justify-center rounded-full hover:bg-primary/15"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
      <DropdownMenuContent align="start" className="w-56">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function cap(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
