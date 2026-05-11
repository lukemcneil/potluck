"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  Archive,
  ArchiveRestore,
  MoreVertical,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  addShoppingItemAction,
  deleteShoppingItemAction,
  deleteShoppingListAction,
  setShoppingListArchivedAction,
  toggleShoppingItemAction,
} from "@/lib/actions/shopping";

export type ListItemView = {
  id: string;
  name: string;
  quantity: string | null;
  unit: string | null;
  checked: boolean;
  source: { recipeId: string; recipeTitle: string } | null;
};

type Props = {
  listId: string;
  name: string;
  archived: boolean;
  items: ListItemView[];
};

/**
 * Tap-to-check list view + quick "add an item" form + a dropdown for
 * archive / delete. All mutations are optimistic; failures rollback +
 * toast.
 */
export function ShoppingListView({
  listId,
  name,
  archived,
  items: initialItems,
}: Props) {
  const [items, setItems] = useState(initialItems);
  const [draftName, setDraftName] = useState("");
  const [adding, startAdd] = useTransition();
  const router = useRouter();

  const remaining = useMemo(
    () => items.filter((i) => !i.checked).length,
    [items],
  );

  function toggle(id: string) {
    const previous = items;
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, checked: !i.checked } : i)),
    );
    void toggleShoppingItemAction(id).then((res) => {
      if (!res.ok) {
        setItems(previous);
        toast.error(res.error ?? "Couldn't toggle that item.");
      }
    });
  }

  function remove(id: string) {
    const previous = items;
    setItems((prev) => prev.filter((i) => i.id !== id));
    void deleteShoppingItemAction(id).then((res) => {
      if (!res.ok) {
        setItems(previous);
        toast.error(res.error ?? "Couldn't delete that item.");
      }
    });
  }

  function add() {
    const trimmed = draftName.trim();
    if (!trimmed) return;
    const tempId = `temp-${Math.random().toString(36).slice(2)}`;
    const optimistic: ListItemView = {
      id: tempId,
      name: trimmed,
      quantity: null,
      unit: null,
      checked: false,
      source: null,
    };
    setItems((prev) => [...prev, optimistic]);
    setDraftName("");
    startAdd(async () => {
      const res = await addShoppingItemAction(listId, { name: trimmed });
      if (!res.ok || !res.data) {
        setItems((prev) => prev.filter((i) => i.id !== tempId));
        setDraftName(trimmed);
        toast.error(res.error ?? "Couldn't add that.");
        return;
      }
      setItems((prev) =>
        prev.map((i) => (i.id === tempId ? { ...i, id: res.data!.id } : i)),
      );
    });
  }

  async function archiveOrUnarchive() {
    const next = !archived;
    const res = await setShoppingListArchivedAction(listId, next);
    if (!res.ok) {
      toast.error(res.error ?? "Couldn't update the list.");
      return;
    }
    router.refresh();
  }

  async function destroy() {
    if (
      !confirm(
        `Delete "${name}"? This removes the list and every item on it.`,
      )
    )
      return;
    const res = await deleteShoppingListAction(listId);
    if (!res.ok) {
      toast.error(res.error ?? "Couldn't delete the list.");
      return;
    }
    router.push("/cookbook/lists");
  }

  return (
    <>
      <div className="mt-2 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {name}
            {archived && (
              <span className="ml-2 align-middle rounded-full bg-muted px-2 py-0.5 text-xs font-semibold uppercase text-muted-foreground">
                archived
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {items.length === 0
              ? "Nothing on this list yet."
              : `${remaining} of ${items.length} left to grab.`}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button size="icon" variant="outline" aria-label="List actions" />
            }
          >
            <MoreVertical className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={archiveOrUnarchive}>
              {archived ? (
                <>
                  <ArchiveRestore className="mr-2 size-4" />
                  Restore
                </>
              ) : (
                <>
                  <Archive className="mr-2 size-4" />
                  Archive
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={destroy}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 size-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ul
        className="mt-6 divide-y divide-border rounded-2xl border border-border bg-card"
        aria-label="Shopping list items"
      >
        {items.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-muted-foreground">
            Empty — add an item below or open a recipe and use{" "}
            <em>Shopping list</em>.
          </li>
        )}
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 px-4 py-3">
            <button
              type="button"
              role="checkbox"
              aria-checked={item.checked}
              aria-label={`${item.checked ? "Uncheck" : "Check"} ${item.name}`}
              onClick={() => toggle(item.id)}
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-md border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                item.checked
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:border-primary/50",
              )}
            >
              {item.checked && <Check />}
            </button>
            <div className="min-w-0 flex-1">
              <span
                className={cn(
                  "text-sm",
                  item.checked && "text-muted-foreground line-through",
                )}
              >
                {(item.quantity || item.unit) && (
                  <span className="font-semibold tabular-nums">
                    {[item.quantity, item.unit].filter(Boolean).join(" ")}{" "}
                  </span>
                )}
                {item.name}
              </span>
              {item.source && (
                <Link
                  href={`/r/${item.source.recipeId}`}
                  className="ml-2 text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  from {item.source.recipeTitle}
                </Link>
              )}
            </div>
            <button
              type="button"
              onClick={() => remove(item.id)}
              aria-label={`Delete ${item.name}`}
              className="rounded-md p-1 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ul>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <label htmlFor="add-item" className="sr-only">
          Add an item
        </label>
        <Input
          id="add-item"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          placeholder="Add an item…"
          maxLength={200}
          disabled={adding}
        />
        <Button
          type="submit"
          className="gap-1.5"
          disabled={adding || draftName.trim().length === 0}
        >
          <Plus className="size-4" />
          Add
        </Button>
      </form>
    </>
  );
}

function Check() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.5"
    >
      <path d="M3 8.5l3 3 7-7" />
    </svg>
  );
}
