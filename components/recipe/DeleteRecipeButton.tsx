"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteRecipeAction } from "@/lib/actions/recipes";

type Props = {
  recipeId: string;
  /**
   * The author's handle. When present we send the user back to their
   * own profile after deletion so they land somewhere their stuff
   * lives; without a handle we fall back to /feed.
   */
  authorHandle?: string | null;
  /**
   * Recipe title is shown in the confirmation copy so the user can
   * sanity-check what's about to disappear (especially relevant on
   * shared family deployments).
   */
  recipeTitle: string;
};

/**
 * Destructive author-only action. Hard-deletes the recipe (and all
 * its ingredients/steps/photos/tags/saves/ratings/comments via the
 * schema's ON DELETE CASCADE) after a confirm dialog.
 *
 * The action itself (`deleteRecipeAction`) throws on the unhappy
 * paths (UNAUTHENTICATED / FORBIDDEN) and returns void on success.
 * Since the button is only rendered to the author, those throws are
 * effectively unreachable in normal use — we still catch them and
 * surface a generic toast so a stale tab or a race doesn't leave the
 * user staring at a blank screen.
 */
export function DeleteRecipeButton({
  recipeId,
  authorHandle,
  recipeTitle,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      try {
        await deleteRecipeAction(recipeId);
        toast.success("Recipe deleted");
        // Land somewhere coherent. The user just nuked the page they
        // were standing on, so we have to navigate — the action's
        // revalidatePath calls keep the destination fresh.
        router.push(authorHandle ? `/u/${authorHandle}` : "/feed");
      } catch (err) {
        // Best-effort: don't show internal codes to the user.
        const message =
          err instanceof Error && err.message
            ? err.message === "UNAUTHENTICATED"
              ? "You need to be signed in to do that."
              : err.message === "FORBIDDEN"
                ? "Only the author can delete this recipe."
                : "Couldn't delete that recipe."
            : "Couldn't delete that recipe.";
        toast.error(message);
        setOpen(false);
      }
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5 text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
        aria-label="Delete recipe"
      >
        <Trash2 className="size-3.5" />
        Delete
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this recipe?</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{recipeTitle}</span>{" "}
              will be permanently removed, along with its photos, ingredients,
              steps, ratings, and comments. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirm}
              disabled={pending}
            >
              {pending ? "Deleting…" : "Delete forever"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
