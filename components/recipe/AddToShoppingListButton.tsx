"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ShoppingCart, Plus, Check } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { addRecipesToShoppingListAction } from "@/lib/actions/shopping";

type Props = {
  recipeId: string;
  recipeTitle: string;
  /** Active (non-archived) lists for the signed-in user. */
  lists: Array<{ id: string; name: string }>;
};

const NEW_LIST_KEY = "__new__";

/**
 * Recipe-detail action that adds the recipe's ingredients to a
 * shopping list. Pick an existing active list or create a new one
 * named after the recipe (or whatever the user types).
 *
 * Consolidation across multiple recipes happens in
 * `lib/shopping/consolidate.ts`; here we send a single recipe id and
 * the server merges with whatever's already on the list (no — items
 * are appended; merging into an existing list could surprise people
 * mid-shop. Future work if it gets noisy.)
 */
export function AddToShoppingListButton({
  recipeId,
  recipeTitle,
  lists,
}: Props) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<string>(
    lists.length > 0 ? lists[0].id : NEW_LIST_KEY,
  );
  const [newName, setNewName] = useState(recipeTitle);
  const [submitting, startSubmit] = useTransition();

  function submit() {
    startSubmit(async () => {
      const res = await addRecipesToShoppingListAction({
        targetListId: target === NEW_LIST_KEY ? null : target,
        newListName: target === NEW_LIST_KEY ? newName.trim() : undefined,
        recipeIds: [recipeId],
      });
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't add to shopping list.");
        return;
      }
      const noun = res.data!.addedCount === 1 ? "ingredient" : "ingredients";
      toast.success(
        `Added ${res.data!.addedCount} ${noun} to your list.`,
        {
          action: {
            label: "Open",
            onClick: () => {
              window.location.href = `/cookbook/lists/${res.data!.listId}`;
            },
          },
        },
      );
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline" className="gap-1.5" />
        }
      >
        <ShoppingCart className="size-3.5" aria-hidden />
        Shopping list
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to shopping list</DialogTitle>
          <DialogDescription>
            We&apos;ll consolidate identical ingredients automatically.
          </DialogDescription>
        </DialogHeader>

        <div
          className="space-y-1.5"
          role="radiogroup"
          aria-label="Shopping list"
        >
          {lists.map((l) => (
            <button
              key={l.id}
              type="button"
              role="radio"
              aria-checked={target === l.id}
              onClick={() => setTarget(l.id)}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition",
                target === l.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-card/60",
              )}
            >
              <span className="truncate">{l.name}</span>
              {target === l.id && (
                <Check className="size-4 text-primary" aria-hidden />
              )}
            </button>
          ))}

          <button
            type="button"
            role="radio"
            aria-checked={target === NEW_LIST_KEY}
            onClick={() => setTarget(NEW_LIST_KEY)}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition",
              target === NEW_LIST_KEY
                ? "border-primary bg-primary/5"
                : "border-dashed border-border hover:bg-card/60",
            )}
          >
            <Plus className="size-4" aria-hidden />
            New list
          </button>
        </div>

        {target === NEW_LIST_KEY && (
          <div className="space-y-1.5">
            <Label htmlFor="new-list-name">New list name</Label>
            <Input
              id="new-list-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={80}
              placeholder="Groceries"
            />
          </div>
        )}

        <DialogFooter className="mt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={
              submitting ||
              (target === NEW_LIST_KEY && newName.trim().length === 0)
            }
            className="gap-1.5"
          >
            <ShoppingCart className="size-4" aria-hidden />
            Add ingredients
          </Button>
        </DialogFooter>

        {lists.length > 0 && (
          <p className="text-center text-xs text-muted-foreground">
            <Link
              href="/cookbook/lists"
              className="hover:text-foreground hover:underline"
            >
              Manage shopping lists
            </Link>
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
