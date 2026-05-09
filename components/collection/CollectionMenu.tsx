"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  deleteCollectionAction,
  updateCollectionAction,
} from "@/lib/actions/collections";

const VISIBILITIES: Array<{
  value: "public" | "unlisted" | "private";
  label: string;
}> = [
  { value: "public", label: "Public" },
  { value: "unlisted", label: "Unlisted" },
  { value: "private", label: "Private" },
];

type Props = {
  collectionId: string;
  handle: string;
  initialName: string;
  initialDescription: string | null;
  initialVisibility: "public" | "unlisted" | "private";
};

export function CollectionMenu({
  collectionId,
  handle,
  initialName,
  initialDescription,
  initialVisibility,
}: Props) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [visibility, setVisibility] = useState(initialVisibility);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      const res = await updateCollectionAction(collectionId, {
        name: name.trim(),
        description: description.trim() || null,
        visibility,
      });
      if (res.ok) {
        toast.success("Collection updated");
        setEditOpen(false);
        router.refresh();
      } else {
        toast.error(res.error ?? "Couldn't update");
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const res = await deleteCollectionAction(collectionId);
      if (res.ok) {
        toast.success("Collection deleted");
        router.push(`/u/${handle}`);
      } else {
        toast.error(res.error ?? "Couldn't delete");
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="icon" aria-label="Actions">
              <MoreHorizontal className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            render={
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="w-full"
              />
            }
          >
            <Pencil className="size-4" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            render={
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                className="w-full"
              />
            }
          >
            <Trash2 className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit collection</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-desc">Description</Label>
              <Textarea
                id="edit-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={500}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Visibility</Label>
              <div className="grid grid-cols-3 gap-2">
                {VISIBILITIES.map((v) => {
                  const selected = visibility === v.value;
                  return (
                    <button
                      key={v.value}
                      type="button"
                      onClick={() => setVisibility(v.value)}
                      className={cn(
                        "rounded-lg border p-2 text-sm transition",
                        selected
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted",
                      )}
                    >
                      {v.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={pending || !name.trim()}
            >
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this collection?</DialogTitle>
            <DialogDescription>
              The recipes themselves are not affected — they&apos;ll stay in
              your other collections (and in All Saves if applicable).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={pending}
            >
              {pending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
