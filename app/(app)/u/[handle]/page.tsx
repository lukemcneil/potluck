import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { users } from "@/db/schema";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { auth } from "@/lib/auth";
import { listRecipeCards } from "@/lib/queries/recipes";
import { RecipeCard } from "@/components/recipe/RecipeCard";
import { ChefHat } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const profile = db
    .select()
    .from(users)
    .where(eq(users.handle, handle))
    .get();

  if (!profile) notFound();

  const session = await auth();
  const isOwnProfile = session?.user?.id === profile.id;

  const recipes = await listRecipeCards({
    authorId: profile.id,
    publicOnly: !isOwnProfile,
    limit: 48,
  });

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <header className="flex items-center gap-4">
        <Avatar className="size-16">
          <AvatarImage src={profile.image ?? undefined} alt="" />
          <AvatarFallback className="text-xl">
            {(profile.name ?? profile.handle ?? "?").charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {profile.name ?? profile.handle}
          </h1>
          <p className="text-sm text-muted-foreground">@{profile.handle}</p>
          {profile.bio && (
            <p className="mt-1 max-w-prose text-sm">{profile.bio}</p>
          )}
        </div>
      </header>

      <Tabs defaultValue="recipes" className="mt-8">
        <TabsList>
          <TabsTrigger value="recipes">
            Recipes{recipes.length > 0 ? ` (${recipes.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="collections">Collections</TabsTrigger>
          {isOwnProfile && <TabsTrigger value="saved">Saved</TabsTrigger>}
        </TabsList>

        <TabsContent value="recipes" className="mt-6">
          {recipes.length === 0 ? (
            <ProfileEmpty
              title={
                isOwnProfile
                  ? "You haven't added a recipe yet"
                  : "No recipes yet"
              }
              body={
                isOwnProfile
                  ? "Tap the + tab to add your first one. Snap a photo of a recipe card and we'll do the rest."
                  : "Check back soon."
              }
            />
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {recipes.map((r) => (
                <li key={r.id}>
                  <RecipeCard recipe={r} hideAuthor />
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="collections" className="mt-6">
          <ProfileEmpty
            title="No collections yet"
            body="Collections let you group recipes — &lsquo;Mom&apos;s Recipes,&rsquo; &lsquo;Weeknight Dinners,&rsquo; etc. Coming up next."
          />
        </TabsContent>
        {isOwnProfile && (
          <TabsContent value="saved" className="mt-6">
            <ProfileEmpty
              title="Nothing saved yet"
              body="Recipes you save from other cooks will appear here."
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function ProfileEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
      <ChefHat className="size-8 text-muted-foreground" />
      <h3 className="mt-3 font-display text-lg font-semibold">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
