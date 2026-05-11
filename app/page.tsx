import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ChefHat, Camera, BookOpen, Users } from "lucide-react";

export default function HomePage() {
  return (
    <main className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <div className="flex items-center gap-2">
          <ChefHat className="size-6 text-primary" />
          <span className="font-display text-xl font-semibold tracking-tight">
            Potluck
          </span>
        </div>
        <nav className="flex items-center gap-2">
          <Button render={<Link href="/feed" />} variant="ghost" size="sm">
            Browse recipes
          </Button>
          <Button render={<Link href="/signin" />} size="sm">
            Sign in
          </Button>
        </nav>
      </header>

      <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-8 px-6 py-16 text-center sm:py-24">
        <span className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
          Snap. Save. Share.
        </span>
        <h1 className="font-display text-5xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-6xl md:text-7xl">
          The cookbook you build
          <br />
          <span className="text-primary">with everyone you cook for.</span>
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground text-balance">
          Take a photo of any recipe — handwritten card, magazine page, screenshot — and Potluck turns it into a clean, editable recipe card. Organize into collections, browse friends&apos; kitchens, save what you love.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button render={<Link href="/signin" />} size="lg">
            Get started
          </Button>
          <Button render={<Link href="/feed" />} size="lg" variant="outline">
            See the feed
          </Button>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-5xl gap-4 px-6 pb-24 sm:grid-cols-3">
        <Feature
          icon={<Camera className="size-5" />}
          title="Photo to recipe"
          body="Snap one or more photos and AI extracts a structured, editable recipe — handwriting included."
        />
        <Feature
          icon={<BookOpen className="size-5" />}
          title="Collections you'll love"
          body="Group by 'Mom's Recipes,' 'Weeknight Dinners,' or anything else. Public, unlisted, or private."
        />
        <Feature
          icon={<Users className="size-5" />}
          title="A shared table"
          body="Browse other cooks, save their recipes to your cookbook, and build a kitchen together."
        />
      </section>
    </main>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <h2 className="mt-4 text-base font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
