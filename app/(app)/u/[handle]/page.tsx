import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { users } from "@/db/schema";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const profile = await db
    .select()
    .from(users)
    .where(eq(users.handle, handle))
    .get();

  if (!profile) notFound();

  const session = await auth();
  const isOwnProfile = session?.user?.id === profile.id;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
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
          <TabsTrigger value="recipes">Recipes</TabsTrigger>
          <TabsTrigger value="collections">Collections</TabsTrigger>
          {isOwnProfile && <TabsTrigger value="saved">Saved</TabsTrigger>}
        </TabsList>

        <TabsContent value="recipes" className="mt-6">
          <p className="text-sm text-muted-foreground">No recipes yet.</p>
        </TabsContent>
        <TabsContent value="collections" className="mt-6">
          <p className="text-sm text-muted-foreground">No collections yet.</p>
        </TabsContent>
        {isOwnProfile && (
          <TabsContent value="saved" className="mt-6">
            <p className="text-sm text-muted-foreground">
              Recipes you&apos;ve saved will appear here.
            </p>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
