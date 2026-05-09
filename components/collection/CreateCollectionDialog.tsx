"use client";

import { useState, useTransition, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";

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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { createCollectionAction } from "@/lib/actions/collections";

const VISIBILITIES: Array<{
  value: "public" | "unlisted" | "private";
  label: string;
  hint: string;
}> = [
  { value: "public", label: "Public", hint: "Anyone can see it" },
  { value: "unlisted", label: "Unlisted", hint: "Only with the link" },
  { value: "private", label: "Private", hint: "Just you" },
];

export function CreateCollectionDialog({
  trigger,
}: {
  trigger?: ReactElement;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] =
    useState<"public" | "unlisted" | "private">("public");
  const [pending, startTransition] = useTransition();

  function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const res = await createCollectionAction({
        name: trimmed,
        description: description.trim() || null,
        visibility,
      });
      if (res.ok) {
        toast.success("Collection created");
        setOpen(false);
        setName("");
        setDescription("");
        setVisibility("public");
        router.refresh();
      } else {
        toast.error(res.error ?? "Couldn't create");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          trigger ?? (
            <Button size="sm" className="gap-1.5">
              <Plus className="size-4" />
              New collection
            </Button>
          )
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New collection</DialogTitle>
          <DialogDescription>
            Group recipes that go together — like &ldquo;Mom&apos;s
            Recipes&rdquo; or &ldquo;Weeknight Dinners.&rdquo;
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="collection-name">Name</Label>
            <Input
              id="collection-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Weeknight dinners"
              maxLength={80}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="collection-desc">Description</Label>
            <Textarea
              id="collection-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
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
                      "rounded-lg border p-2 text-left text-xs transition",
                      selected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted",
                    )}
                  >
                    <div className="text-sm font-medium">{v.label}</div>
                    <div className="text-muted-foreground">{v.hint}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={pending || !name.trim()}
          >
            {pending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
