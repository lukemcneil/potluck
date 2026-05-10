"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { z, ZodError } from "zod";

import { db } from "@/db/client";
import { users } from "@/db/schema";
import { auth } from "@/lib/auth";
import { handleSchema } from "@/lib/validators";

const profileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(80, "Name is too long"),
  handle: handleSchema,
  bio: z
    .string()
    .trim()
    .max(280, "Bio is at most 280 characters")
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export type ProfileFormInput = z.input<typeof profileSchema>;

type ActionResult<T = unknown> = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  data?: T;
};

export async function updateProfileAction(
  input: ProfileFormInput,
): Promise<ActionResult<{ handle: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Sign in required." };
  const userId = session.user.id;

  let parsed: z.output<typeof profileSchema>;
  try {
    parsed = profileSchema.parse(input);
  } catch (err) {
    if (err instanceof ZodError) {
      return {
        ok: false,
        error: "Some fields need attention.",
        fieldErrors: err.flatten().fieldErrors as Record<string, string[]>,
      };
    }
    return { ok: false, error: "Invalid form data." };
  }

  // Get the current handle so we can revalidate the old profile path
  // when the user changes it.
  const current = db
    .select({ handle: users.handle })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  if (!current) return { ok: false, error: "Profile not found." };

  // Handle uniqueness — case-insensitive (handles are stored lowercase
  // already; the schema enforces lowercase). Skip the check when the
  // handle hasn't changed.
  if (parsed.handle !== current.handle) {
    const conflict = db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.handle, parsed.handle), ne(users.id, userId)))
      .get();
    if (conflict) {
      return {
        ok: false,
        error: "That handle is taken.",
        fieldErrors: { handle: ["Already taken — try another."] },
      };
    }
  }

  db.update(users)
    .set({
      name: parsed.name,
      handle: parsed.handle,
      bio: parsed.bio ?? null,
    })
    .where(eq(users.id, userId))
    .run();

  // Revalidate both the old and new profile URLs so cached views update.
  if (current.handle) revalidatePath(`/u/${current.handle}`);
  revalidatePath(`/u/${parsed.handle}`);
  revalidatePath("/me");

  return { ok: true, data: { handle: parsed.handle } };
}
