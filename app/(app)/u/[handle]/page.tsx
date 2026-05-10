import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ChefHat, Folder } from "lucide-react";

import { db } from "@/db/client";
import { users } from "@/db/schema";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { auth } from "@/lib/auth";
import { listRecipeCards } from "@/lib/queries/recipes";
import { listCollectionsForUser } from "@/lib/queries/collections";
import { monthlySpendForUser } from "@/lib/queries/ai-usage";
import { RecipeCard } from "@/components/recipe/RecipeCard";
import { CollectionCard } from "@/components/collection/CollectionCard";
import { CreateCollectionDialog } from "@/components/collection/CreateCollectionDialog";
import { ProfileEditDialog } from "@/components/profile/ProfileEditDialog";
import { AiUsageCard } from "@/components/profile/AiUsageCard";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const profile = db
    .select({ name: users.name, handle: users.handle, bio: users.bio })
    .from(users)
    .where(eq(users.handle, handle))
    .get();
  if (!profile) return { title: "Profile not found" };
  const display = profile.name?.trim() || `@${profile.handle ?? handle}`;
  return {
    title: display,
    description: profile.bio?.trim() || undefined,
  };
}

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

  const [recipes, collections, aiSpend] = await Promise.all([
    listRecipeCards({
      authorId: profile.id,
      publicOnly: !isOwnProfile,
      limit: 48,
    }),
    listCollectionsForUser(profile.id, { publicOnly: !isOwnProfile }),
    isOwnProfile ? monthlySpendForUser(profile.id) : Promise.resolve(null),
  ]);

  const aiCapEnv = process.env.POTLUCK_USER_MONTHLY_USD_CAP;
  const aiCapUsd = (() => {
    if (!aiCapEnv) return null;
    const n = Number(aiCapEnv);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  // Hide the All Saves collection from non-owners (it's always private anyway,
  // but defensively filter the list).
  const visibleCollections = isOwnProfile
    ? collections
    : collections.filter((c) => !c.isDefaultSaves);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <header className="flex items-start gap-4">
        <Avatar className="size-16">
          <AvatarImage src={profile.image ?? undefined} alt="" />
          <AvatarFallback className="text-xl">
            {(profile.name ?? profile.handle ?? "?").charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {profile.name ?? profile.handle}
          </h1>
          <p className="text-sm text-muted-foreground">@{profile.handle}</p>
          {profile.bio && (
            <p className="mt-1 max-w-prose text-sm">{profile.bio}</p>
          )}
        </div>
        {isOwnProfile && profile.handle && (
          <ProfileEditDialog
            initial={{
              name: profile.name ?? "",
              handle: profile.handle,
              bio: profile.bio ?? null,
            }}
          />
        )}
      </header>

      {isOwnProfile && aiSpend && (
        <div className="mt-6 max-w-md">
          <AiUsageCard spend={aiSpend} capUsd={aiCapUsd} />
        </div>
      )}

      <Tabs defaultValue="recipes" className="mt-8">
        <TabsList>
          <TabsTrigger value="recipes">
            Recipes{recipes.length > 0 ? ` (${recipes.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="collections">
            Collections
            {visibleCollections.length > 0 ? ` (${visibleCollections.length})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="recipes" className="mt-6">
          {recipes.length === 0 ? (
            <ProfileEmpty
              icon="chef"
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
              {recipes.map((r, i) => (
                <li key={r.id}>
                  <RecipeCard recipe={r} hideAuthor priority={i < 3} />
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="collections" className="mt-6 space-y-4">
          {isOwnProfile && (
            <div className="flex justify-end">
              <CreateCollectionDialog />
            </div>
          )}
          {visibleCollections.length === 0 ? (
            <ProfileEmpty
              icon="folder"
              title="No collections yet"
              body={
                isOwnProfile
                  ? "Group recipes — \u2018Mom\u2019s Recipes,\u2019 \u2018Weeknight Dinners,\u2019 etc. Tap New collection to start."
                  : "This cook hasn't shared any collections yet."
              }
            />
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibleCollections.map((c) => (
                <li key={c.id}>
                  <CollectionCard
                    collection={c}
                    viewerHandle={profile.handle}
                  />
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProfileEmpty({
  title,
  body,
  icon,
}: {
  title: string;
  body: string;
  icon: "chef" | "folder";
}) {
  const Icon = icon === "chef" ? ChefHat : Folder;
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
      <Icon className="size-8 text-muted-foreground" />
      <h3 className="mt-3 font-display text-lg font-semibold">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
