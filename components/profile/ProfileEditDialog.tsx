"use client";

import { useState, useTransition, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
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
import { updateProfileAction } from "@/lib/actions/profile";

type Initial = {
  name: string;
  handle: string;
  bio: string | null;
};

type Props = {
  initial: Initial;
  trigger?: ReactElement;
};

export function ProfileEditDialog({ initial, trigger }: Props) {
  const [open, setOpen] = useState(false);
  // Bumped every time the dialog opens. Used as a key on the inner
  // form so it remounts with fresh `useState` initializers each time —
  // that way we get the "reset on open" behavior without a setState-
  // in-effect anti-pattern (React 19 flags it as cascading renders).
  const [openSeq, setOpenSeq] = useState(0);

  function handleOpenChange(next: boolean) {
    if (next && !open) setOpenSeq((s) => s + 1);
    setOpen(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          trigger ?? (
            <Button size="sm" variant="outline" className="gap-1.5">
              <Pencil className="size-3.5" />
              Edit profile
            </Button>
          )
        }
      />
      <DialogContent>
        <ProfileEditForm
          key={openSeq}
          initial={initial}
          onClose={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ProfileEditForm({
  initial,
  onClose,
}: {
  initial: Initial;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [handle, setHandle] = useState(initial.handle);
  const [bio, setBio] = useState(initial.bio ?? "");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  function handleSubmit() {
    setErrors({});
    startTransition(async () => {
      const res = await updateProfileAction({
        name,
        handle: handle.trim().toLowerCase(),
        bio: bio.trim() || null,
      });
      if (res.ok) {
        toast.success("Profile updated");
        onClose();
        // If the handle changed the page URL changes too — redirect.
        if (res.data?.handle && res.data.handle !== initial.handle) {
          router.replace(`/u/${res.data.handle}`);
        } else {
          router.refresh();
        }
      } else {
        if (res.fieldErrors) setErrors(res.fieldErrors);
        toast.error(res.error ?? "Couldn't save profile");
      }
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit profile</DialogTitle>
        <DialogDescription>
          Your handle is the URL of your profile, e.g.{" "}
          <span className="font-mono">/u/{handle || "your-handle"}</span>.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="profile-name">Name</Label>
          <Input
            id="profile-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            autoFocus
          />
          <FieldError errors={errors.name} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="profile-handle">Handle</Label>
          <Input
            id="profile-handle"
            value={handle}
            onChange={(e) =>
              setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
            }
            placeholder="your-handle"
            maxLength={32}
          />
          <p className="text-[11px] text-muted-foreground">
            Lowercase letters, numbers, and dashes. 2&ndash;32 chars.
          </p>
          <FieldError errors={errors.handle} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="profile-bio">Bio</Label>
          <Textarea
            id="profile-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            maxLength={280}
            placeholder="A line or two about your kitchen."
          />
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {bio.length}/280
          </p>
          <FieldError errors={errors.bio} />
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={pending || !name.trim() || handle.length < 2}
        >
          {pending ? "Saving\u2026" : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null;
  return <p className="text-xs text-destructive">{errors[0]}</p>;
}
