"use client";

import { useEffect, useState, useTransition, type ReactElement } from "react";
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

type Props = {
  initial: {
    name: string;
    handle: string;
    bio: string | null;
  };
  trigger?: ReactElement;
};

export function ProfileEditDialog({ initial, trigger }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial.name);
  const [handle, setHandle] = useState(initial.handle);
  const [bio, setBio] = useState(initial.bio ?? "");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  // Reset local state when the dialog opens so it always reflects the
  // currently-saved profile, even after a previous successful submit.
  useEffect(() => {
    if (open) {
      setName(initial.name);
      setHandle(initial.handle);
      setBio(initial.bio ?? "");
      setErrors({});
    }
  }, [open, initial]);

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
        setOpen(false);
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
    <Dialog open={open} onOpenChange={setOpen}>
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
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
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
      </DialogContent>
    </Dialog>
  );
}

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null;
  return <p className="text-xs text-destructive">{errors[0]}</p>;
}
