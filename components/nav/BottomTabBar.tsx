"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Search, Plus, BookmarkCheck, User } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  matches: (path: string) => boolean;
  highlight?: boolean;
};

const TABS: Tab[] = [
  {
    href: "/feed",
    label: "Home",
    icon: Home,
    matches: (p) => p === "/feed" || p === "/",
  },
  {
    href: "/search",
    label: "Search",
    icon: Search,
    matches: (p) => p.startsWith("/search"),
  },
  {
    href: "/add",
    label: "Add",
    icon: Plus,
    matches: (p) => p.startsWith("/add"),
    highlight: true,
  },
  {
    href: "/cookbook",
    label: "Cookbook",
    icon: BookmarkCheck,
    matches: (p) => p.startsWith("/cookbook"),
  },
  {
    href: "/me",
    label: "Profile",
    icon: User,
    // Match the profile root only, not nested resources like
    // collection detail pages (/u/[handle]/c/[slug]) which are
    // browsed from Cookbook context and shouldn't light up Profile.
    matches: (p) =>
      p === "/me" || /^\/u\/[^/]+\/?$/.test(p),
  },
];

export function BottomTabBar() {
  const pathname = usePathname() ?? "/";

  return (
    <nav
      aria-label="Primary"
      data-bottom-tab-bar
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/70 md:hidden"
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-around px-2 pt-1.5 pb-1">
        {TABS.map((tab) => {
          const active = tab.matches(pathname);
          const Icon = tab.icon;

          if (tab.highlight) {
            return (
              <li key={tab.href} className="-mt-5">
                <Link
                  href={tab.href}
                  aria-label={tab.label}
                  aria-current={active ? "page" : undefined}
                  className="flex flex-col items-center gap-0.5"
                >
                  <span
                    className={cn(
                      "flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/20 ring-4 ring-background transition active:scale-95",
                      // Subtle ring brightening when this is the
                      // current tab, so the floating button reflects
                      // active state instead of looking identical on
                      // every page.
                      active && "ring-primary/30",
                    )}
                  >
                    <Icon className="size-6" />
                  </span>
                  <span
                    className={cn(
                      "text-[11px] font-medium",
                      active ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    {tab.label}
                  </span>
                </Link>
              </li>
            );
          }

          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-5" />
                <span>{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
