"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Trash2, Send } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  addCommentAction,
  deleteCommentAction,
} from "@/lib/actions/comments";

export type CommentItem = {
  id: string;
  body: string;
  /** ISO 8601 string. RSC pages can't pass a `Date` instance. */
  createdAt: string;
  author: {
    id: string;
    name: string | null;
    handle: string | null;
    image: string | null;
  };
  canDelete: boolean;
};

type Props = {
  recipeId: string;
  comments: CommentItem[];
  recipeAuthorId: string;
  viewer: { id: string; name: string | null; image: string | null } | null;
};

const MAX_LEN = 2000;

export function CommentsSection({
  recipeId,
  comments,
  recipeAuthorId,
  viewer,
}: Props) {
  const [items, setItems] = useState<CommentItem[]>(comments);
  const [body, setBody] = useState("");
  const [submitting, startSubmit] = useTransition();

  function submit() {
    const trimmed = body.trim();
    if (trimmed.length === 0 || !viewer) return;
    if (trimmed.length > MAX_LEN) {
      toast.error(`Keep it under ${MAX_LEN} characters.`);
      return;
    }
    const tempId = `temp-${Math.random().toString(36).slice(2)}`;
    const optimistic: CommentItem = {
      id: tempId,
      body: trimmed,
      createdAt: new Date().toISOString(),
      author: {
        id: viewer.id,
        name: viewer.name,
        handle: null,
        image: viewer.image,
      },
      canDelete: true,
    };
    setItems((prev) => [...prev, optimistic]);
    setBody("");

    startSubmit(async () => {
      const res = await addCommentAction(recipeId, trimmed);
      if (!res.ok) {
        setItems((prev) => prev.filter((c) => c.id !== tempId));
        setBody(trimmed);
        toast.error(res.error ?? "Couldn't post your comment.");
        return;
      }
      // Replace the optimistic temp id with the real one returned by
      // the server, so the delete button targets the right row.
      setItems((prev) =>
        prev.map((c) => (c.id === tempId ? { ...c, id: res.data!.id } : c)),
      );
    });
  }

  function remove(id: string) {
    const previous = items;
    setItems((prev) => prev.filter((c) => c.id !== id));
    void deleteCommentAction(id).then((res) => {
      if (!res.ok) {
        setItems(previous);
        toast.error(res.error ?? "Couldn't delete that comment.");
      }
    });
  }

  return (
    <section
      id="comments"
      className="mt-4 scroll-mt-20"
      aria-label="Comments"
      data-print="hide"
    >
      <h2 className="font-display text-xl font-semibold">
        Comments{items.length > 0 ? ` (${items.length})` : ""}
      </h2>

      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No comments yet — be the first to chime in.
        </p>
      ) : (
        <ul className="mt-4 space-y-5">
          {items.map((c) => (
            <li key={c.id} className="flex gap-3">
              <Avatar className="size-8 shrink-0">
                <AvatarImage src={c.author.image ?? undefined} alt="" />
                <AvatarFallback>
                  {(c.author.name ?? c.author.handle ?? "?")
                    .charAt(0)
                    .toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                  {c.author.handle ? (
                    <Link
                      href={`/u/${c.author.handle}`}
                      className="font-semibold text-foreground hover:underline"
                    >
                      {c.author.name ?? `@${c.author.handle}`}
                    </Link>
                  ) : (
                    <span className="font-semibold text-foreground">
                      {c.author.name ?? "Someone"}
                    </span>
                  )}
                  {c.author.id === recipeAuthorId && (
                    <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                      author
                    </span>
                  )}
                  <span className="text-muted-foreground">
                    {formatRelative(c.createdAt)}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
                  {c.body}
                </p>
              </div>
              {c.canDelete && (
                <button
                  type="button"
                  onClick={() => remove(c.id)}
                  aria-label="Delete comment"
                  className="self-start rounded-md p-1 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {viewer ? (
        <form
          className="mt-6 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor="new-comment" className="sr-only">
            Add a comment
          </label>
          <Textarea
            id="new-comment"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a comment…"
            maxLength={MAX_LEN}
            rows={3}
            disabled={submitting}
            className="resize-y"
          />
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span
              className={cn(
                "tabular-nums",
                body.length > MAX_LEN * 0.9 && "text-destructive",
              )}
            >
              {body.length}/{MAX_LEN}
            </span>
            <Button
              type="submit"
              size="sm"
              className="gap-1.5"
              disabled={submitting || body.trim().length === 0}
            >
              <Send className="size-3.5" aria-hidden />
              Post
            </Button>
          </div>
        </form>
      ) : (
        <p className="mt-6 rounded-xl border border-dashed border-border bg-card/50 p-4 text-sm text-muted-foreground">
          <Link href="/signin" className="font-semibold text-foreground hover:underline">
            Sign in
          </Link>{" "}
          to leave a comment.
        </p>
      )}
    </section>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.max(1, Math.floor((now - then) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(mo / 12);
  return `${yr}y ago`;
}
