import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireSession } from "@/lib/session";
import { getShoppingListForUser } from "@/lib/queries/shopping";
import { ShoppingListView } from "@/components/shopping/ShoppingListView";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  // requireSession can't run during metadata generation without
  // forcing a redirect; just title the page generically and rely on
  // the page body to gate access.
  return {
    title: "Shopping list",
    description: `Items to grab on your next trip (list ${id.slice(0, 6)}).`,
  };
}

export default async function ShoppingListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession(`/cookbook/lists/${id}`);
  const list = getShoppingListForUser(id, session.user.id);
  if (!list) notFound();

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <p className="text-xs text-muted-foreground">
        <Link href="/cookbook/lists" className="hover:text-foreground">
          ← All shopping lists
        </Link>
      </p>

      <ShoppingListView
        listId={list.id}
        name={list.name}
        archived={!!list.archivedAt}
        items={list.items.map((it) => ({
          id: it.id,
          name: it.name,
          quantity: it.quantity,
          unit: it.unit,
          checked: it.checked,
          source: it.source,
        }))}
      />
    </div>
  );
}
