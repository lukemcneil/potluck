import { Camera, Image as ImageIcon, Link as LinkIcon, Pencil } from "lucide-react";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AddRecipePage() {
  await requireSession("/add");

  const options = [
    {
      icon: Camera,
      title: "Take photo",
      body: "Snap a recipe card, magazine page, or screenshot. AI fills in the details.",
    },
    {
      icon: ImageIcon,
      title: "Pick from library",
      body: "Choose photos already on your phone. Multiple pages? No problem.",
    },
    {
      icon: LinkIcon,
      title: "Paste a URL",
      body: "Drop a link to a recipe online and we'll bring it home for you.",
    },
    {
      icon: Pencil,
      title: "Type it in",
      body: "Old-school. Add a recipe by hand if you want full control.",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="font-display text-3xl font-semibold tracking-tight">
        Add a recipe
      </h1>
      <p className="mt-1 text-muted-foreground">
        How would you like to start? You can edit anything before you save.
      </p>

      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {options.map((opt) => (
          <li
            key={opt.title}
            className="flex cursor-not-allowed items-start gap-4 rounded-xl border border-border bg-card p-4 opacity-60"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <opt.icon className="size-5" />
            </span>
            <div>
              <h3 className="font-semibold">{opt.title}</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">{opt.body}</p>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Coming up next — these flows are wired in the next phase.
      </p>
    </div>
  );
}
