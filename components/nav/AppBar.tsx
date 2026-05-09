import Link from "next/link";
import { ChefHat, Search, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { auth, signOut } from "@/lib/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export async function AppBar() {
  const session = await auth();
  const user = session?.user;

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/feed" className="flex items-center gap-2">
          <ChefHat className="size-5 text-primary" />
          <span className="font-display text-lg font-semibold tracking-tight">
            Potluck
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          <Link href="/feed">
            <Button variant="ghost" size="sm">
              Feed
            </Button>
          </Link>
          <Link href="/search">
            <Button variant="ghost" size="sm" className="gap-1.5">
              <Search className="size-4" />
              Search
            </Button>
          </Link>
          <Link href="/cookbook">
            <Button variant="ghost" size="sm">
              Cookbook
            </Button>
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/add" className="hidden md:inline-flex">
            <Button size="sm" className="gap-1.5">
              <Plus className="size-4" />
              New recipe
            </Button>
          </Link>

          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Account menu"
                className={cn(
                  "inline-flex items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                )}
              >
                <Avatar className="size-8">
                  <AvatarImage src={user.image ?? undefined} alt="" />
                  <AvatarFallback>
                    {(user.name ?? user.email ?? "?").charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[12rem]">
                <DropdownMenuLabel className="truncate">
                  {user.name ?? user.email}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem render={<Link href="/me" />}>
                  My profile
                </DropdownMenuItem>
                <DropdownMenuItem render={<Link href="/cookbook" />}>
                  Cookbook
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <SignOutItem />
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Link href="/signin">
              <Button size="sm">Sign in</Button>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function SignOutItem() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    >
      <DropdownMenuItem
        render={
          <button type="submit" className="w-full text-left" />
        }
      >
        Sign out
      </DropdownMenuItem>
    </form>
  );
}
