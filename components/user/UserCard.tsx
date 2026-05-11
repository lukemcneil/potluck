import Link from "next/link";
import { ChefHat } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { UserCardData } from "@/lib/queries/users";

type Props = {
  user: UserCardData;
  variant?: "row" | "card";
  className?: string;
};

export function UserCard({ user, variant = "card", className }: Props) {
  const initial = (user.name ?? user.handle).charAt(0).toUpperCase();
  // Synthesized accessible name so the card link doesn't announce as
  // "Luke McNeil@luke-mcneil9 recipes" (each chunk concatenates from
  // sibling spans). Visible markup is unchanged.
  const recipeWord = user.recipeCount === 1 ? "recipe" : "recipes";
  const ariaLabel = [
    user.name ? `${user.name} (@${user.handle})` : `@${user.handle}`,
    `${user.recipeCount} ${recipeWord}`,
  ].join(", ");

  if (variant === "row") {
    return (
      <Link
        href={`/u/${user.handle}`}
        aria-label={ariaLabel}
        className={cn(
          "flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition hover:bg-muted",
          className,
        )}
      >
        <Avatar className="size-10 shrink-0">
          <AvatarImage src={user.image ?? undefined} alt="" />
          <AvatarFallback>{initial}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium">
              {user.name ?? `@${user.handle}`}
            </p>
            {user.name && (
              <span className="text-xs text-muted-foreground">
                @{user.handle}
              </span>
            )}
          </div>
          {user.bio && (
            <p className="line-clamp-1 text-xs text-muted-foreground">
              {user.bio}
            </p>
          )}
        </div>
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <ChefHat className="size-3.5" />
          {user.recipeCount}
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={`/u/${user.handle}`}
      aria-label={ariaLabel}
      className={cn(
        "group flex flex-col items-center gap-2 rounded-2xl border border-border bg-card p-4 text-center transition hover:shadow-md",
        className,
      )}
    >
      <Avatar className="size-16">
        <AvatarImage src={user.image ?? undefined} alt="" />
        <AvatarFallback className="text-lg">{initial}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="line-clamp-1 font-medium">
          {user.name ?? `@${user.handle}`}
        </p>
        <p className="text-xs text-muted-foreground">@{user.handle}</p>
      </div>
      {user.bio && (
        <p className="line-clamp-2 text-xs text-muted-foreground">{user.bio}</p>
      )}
      <span className="mt-auto flex items-center gap-1 text-xs text-muted-foreground">
        <ChefHat className="size-3.5" />
        {`${user.recipeCount} recipe${user.recipeCount === 1 ? "" : "s"}`}
      </span>
    </Link>
  );
}
