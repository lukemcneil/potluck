"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Bookmark, BookmarkCheck, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { saveRecipeAction, unsaveRecipeAction } from "@/lib/actions/saves";
import { createCollectionAction } from "@/lib/actions/collections";
import {
  addRecipeToCollectionAction,
  removeRecipeFromCollectionAction,
} from "@/lib/actions/collections";

export type CollectionOption = {
  id: string;
  name: string;
  isDefaultSaves: boolean;
};

type Props = {
  recipeId: string;
  initiallySaved: boolean;
  /** Collections owned by the viewer that already contain this recipe. */
  initialCollectionIds: string[];
  /** All of the viewer's collections (including All Saves). */
  collections: CollectionOption[];
  size?: "sm" | "default";
};

export function SaveButton({
  recipeId,
  initiallySaved,
  initialCollectionIds,
  collections,
  size = "default",
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(initiallySaved);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialCollectionIds),
  );
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [localCollections, setLocalCollections] = useState(collections);

  function handleQuickSave() {
    if (saved) {
      setOpen(true);
      return;
    }
    startTransition(async () => {
      const res = await saveRecipeAction(recipeId, []);
      if (res.ok) {
        setSaved(true);
        const allSaves = collections.find((c) => c.isDefaultSaves);
        if (allSaves) setSelected((s) => new Set([...s, allSaves.id]));
        toast.success("Saved to your cookbook");
        router.refresh();
      } else {
        toast.error(res.error ?? "Couldn't save");
      }
    });
  }

  function toggleCollection(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function handleCreateCollection() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const res = await createCollectionAction({
      name: trimmed,
      visibility: "public",
    });
    if (res.ok && res.data) {
      const created: CollectionOption = {
        id: res.data.id,
        name: trimmed,
        isDefaultSaves: false,
      };
      setLocalCollections((cs) => [...cs, created]);
      setSelected((s) => new Set([...s, created.id]));
      setNewName("");
      setCreating(false);
      toast.success("Collection created");
    } else {
      toast.error(res.error ?? "Couldn't create collection");
    }
  }

  async function handleApply() {
    startTransition(async () => {
      // Diff selected vs initial to figure out adds/removes.
      const initial = new Set(initialCollectionIds);
      const toAdd = [...selected].filter((id) => !initial.has(id));
      const toRemove = [...initial].filter((id) => !selected.has(id));

      // If nothing was previously saved AND nothing selected now, this is a no-op.
      if (toAdd.length === 0 && toRemove.length === 0 && saved) {
        setOpen(false);
        return;
      }

      // If the user unchecked everything, treat as full unsave.
      if (selected.size === 0 && saved) {
        const res = await unsaveRecipeAction(recipeId);
        if (!res.ok) {
          toast.error(res.error ?? "Couldn't update");
          return;
        }
        setSaved(false);
        toast.success("Removed from your cookbook");
        setOpen(false);
        router.refresh();
        return;
      }

      // Otherwise: incremental adds/removes.
      const errors: string[] = [];
      if (toAdd.length > 0) {
        // saveRecipeAction handles the "saves" table + All Saves bookkeeping
        // and adds to the listed extras.
        const res = await saveRecipeAction(recipeId, toAdd);
        if (!res.ok) errors.push(res.error ?? "save failed");
      }
      for (const id of toRemove) {
        // Removing a recipe from a non-default collection is a per-collection
        // mutation; the saves table only changes if All Saves itself was
        // unchecked. A pure unsave is handled in the empty-selection branch
        // above, so here we just trim individual collections.
        const res = await removeRecipeFromCollectionAction(id, recipeId);
        if (!res.ok) errors.push(res.error ?? "remove failed");
      }
      if (errors.length > 0) {
        toast.error(errors.join("; "));
        return;
      }
      setSaved(true);
      toast.success("Cookbook updated");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant={saved ? "default" : "outline"}
        size={size}
        className="gap-1.5"
        onClick={handleQuickSave}
        disabled={pending}
      >
        {saved ? (
          <>
            <BookmarkCheck className="size-4" />
            Saved
          </>
        ) : (
          <>
            <Bookmark className="size-4" />
            Save
          </>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        {/* Hidden trigger so opening can be controlled programmatically too */}
        <DialogTrigger className="hidden" />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save to your cookbook</DialogTitle>
            <DialogDescription>
              Pick the collections to add this recipe to.
            </DialogDescription>
          </DialogHeader>

          <ul className="-mx-1 max-h-72 overflow-y-auto px-1">
            {localCollections.map((c) => {
              const isOn = selected.has(c.id);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => toggleCollection(c.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-muted",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <Checkbox checked={isOn} />
                      <span>
                        {c.name}
                        {c.isDefaultSaves && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            default
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {creating ? (
            <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
              <Label htmlFor="new-collection">New collection</Label>
              <div className="flex gap-2">
                <Input
                  id="new-collection"
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleCreateCollection();
                    }
                  }}
                  placeholder="e.g. Weeknight dinners"
                  maxLength={80}
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleCreateCollection()}
                  disabled={!newName.trim()}
                >
                  Create
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => {
                    setCreating(false);
                    setNewName("");
                  }}
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-start gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={() => setCreating(true)}
            >
              <Plus className="size-4" />
              New collection
            </Button>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleApply()}
              disabled={pending}
            >
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Checkbox({ checked }: { checked: boolean }): ReactNode {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded border transition",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-muted-foreground/40",
      )}
    >
      {checked && (
        <svg
          viewBox="0 0 12 12"
          className="size-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 6l3 3 5-6" />
        </svg>
      )}
    </span>
  );
}

// Re-export useful helpers if other components need them.
export { addRecipeToCollectionAction };
