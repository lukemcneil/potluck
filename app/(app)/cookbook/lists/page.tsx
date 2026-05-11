import type { Metadata } from "next";
import Link from "next/link";
import { ShoppingCart, Plus, ChefHat } from "lucide-react";

import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/session";
import { listShoppingListsForUser } from "@/lib/queries/shopping";
import { CreateShoppingListDialog } from "@/components/shopping/CreateShoppingListDialog";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shopping lists",
  description: "Your active and archived shopping lists.",
};

export default async function ShoppingListsPage() {
  const session = await requireSession("/cookbook/lists");
  const userId = session.user.id;

  const lists = listShoppingListsForUser(userId);
  const active = lists.filter((l) => !l.archivedAt);
  const archived = lists.filter((l) => l.archivedAt);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Shopping lists
          </h1>
          <p className="mt-1 text-muted-foreground">
            Build a list from any recipe — open the recipe and tap{" "}
            <span className="font-medium text-foreground">Shopping list</span>.
          </p>
        </div>
        <CreateShoppingListDialog
          trigger={
            <Button size="sm" className="gap-1.5">
              <Plus className="size-4" />
              New list
            </Button>
          }
        />
      </div>

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold">Active</h2>
        {active.length === 0 ? (
          <div className="mt-3 flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 px-6 py-10 text-center">
            <ShoppingCart className="size-7 text-muted-foreground" />
            <p className="mt-3 max-w-md text-sm text-muted-foreground">
              No active lists. Either tap <em>New list</em> above or hop into
              a recipe and add its ingredients.
            </p>
            <Button
              render={<Link href="/feed" />}
              size="sm"
              variant="outline"
              className="mt-3"
            >
              Browse the feed
            </Button>
          </div>
        ) : (
          <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((l) => (
              <li key={l.id}>
                <ListCard list={l} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {archived.length > 0 && (
        <section className="mt-10">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-muted-foreground">
            <ChefHat className="size-4" />
            Archived
          </h2>
          <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {archived.map((l) => (
              <li key={l.id}>
                <ListCard list={l} archived />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ListCard({
  list,
  archived,
}: {
  list: ReturnType<typeof listShoppingListsForUser>[number];
  archived?: boolean;
}) {
  const remaining = list.itemCount - list.checkedCount;
  return (
    <Link
      href={`/cookbook/lists/${list.id}`}
      className="flex h-full flex-col justify-between gap-3 rounded-2xl border border-border bg-card p-4 transition hover:border-primary/30 hover:shadow-sm"
    >
      <div>
        <h3 className="font-display font-semibold tracking-tight">
          {list.name}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {list.itemCount === 0
            ? "Empty"
            : `${remaining} of ${list.itemCount} left to grab`}
        </p>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {new Intl.DateTimeFormat(undefined, {
            month: "short",
            day: "numeric",
          }).format(list.createdAt)}
        </span>
        {archived ? (
          <span className="rounded-full bg-muted px-2 py-0.5 font-semibold uppercase tracking-wide">
            archived
          </span>
        ) : (
          <span className="text-primary">Open →</span>
        )}
      </div>
    </Link>
  );
}
