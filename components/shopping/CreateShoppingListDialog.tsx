"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createShoppingListAction } from "@/lib/actions/shopping";

type Props = {
  trigger: React.ReactElement;
};

/**
 * Tiny "name + create" dialog. Used on the cookbook lists page when
 * the user wants an empty list to fill manually.
 */
export function CreateShoppingListDialog({ trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [submitting, startSubmit] = useTransition();
  const router = useRouter();

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    startSubmit(async () => {
      const res = await createShoppingListAction({ name: trimmed });
      if (!res.ok || !res.data) {
        toast.error(res.error ?? "Couldn't create that list.");
        return;
      }
      setOpen(false);
      setName("");
      router.push(`/cookbook/lists/${res.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New shopping list</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="list-name">Name</Label>
            <Input
              id="list-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="Saturday groceries"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || name.trim().length === 0}
            >
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
