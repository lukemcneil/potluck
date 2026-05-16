import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";
import type { AdapterAccountType } from "next-auth/adapters";

export const MEAL_TYPES = [
  "breakfast",
  "brunch",
  "lunch",
  "dinner",
  "appetizer",
  "side",
  "dessert",
  "snack",
  "drink",
] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const VISIBILITY = ["public", "unlisted", "private"] as const;
export type Visibility = (typeof VISIBILITY)[number];

export const RECIPE_KIND = ["structured", "photos_only"] as const;
export type RecipeKind = (typeof RECIPE_KIND)[number];

/**
 * What a `recipePhotos` row is FOR:
 *
 * - `cover`: a visual / hero photo. Appears in the detail page
 *   carousel, recipe cards, the feed, OG thumbnails, collection
 *   covers. The thing you want strangers to see.
 *
 * - `source`: original material the recipe was lifted from — a paper
 *   recipe card, a magazine clipping, a screenshot. Kept around so
 *   the author can re-verify quantities and steps later, but NOT
 *   shown as the visual identity of the recipe. Surfaced in a
 *   collapsible "Source materials" section on the detail page.
 *
 * One photo has exactly one role. To use the same shot as cover AND
 * source, upload it twice — they're independent rows.
 *
 * Default is `cover` so every photo created before this column
 * existed retains its prior behavior (it was already showing up as
 * the recipe's hero).
 */
export const PHOTO_ROLES = ["cover", "source"] as const;
export type PhotoRole = (typeof PHOTO_ROLES)[number];

export const users = sqliteTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: integer("emailVerified", { mode: "timestamp_ms" }),
  image: text("image"),
  handle: text("handle").unique(),
  bio: text("bio"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const accounts = sqliteTable(
  "accounts",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  ],
);

export const sessions = sqliteTable("sessions", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
});

export const verificationTokens = sqliteTable(
  "verificationTokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
);

export const authenticators = sqliteTable(
  "authenticators",
  {
    credentialID: text("credentialID").notNull().unique(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerAccountId: text("providerAccountId").notNull(),
    credentialPublicKey: text("credentialPublicKey").notNull(),
    counter: integer("counter").notNull(),
    credentialDeviceType: text("credentialDeviceType").notNull(),
    credentialBackedUp: integer("credentialBackedUp", { mode: "boolean" }).notNull(),
    transports: text("transports"),
  },
  (a) => [primaryKey({ columns: [a.userId, a.credentialID] })],
);

export const recipes = sqliteTable(
  "recipes",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    authorId: text("authorId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    /**
     * Free-form notes from the author — tips, substitutions, family
     * context ("Mom always doubled the garlic"), serving suggestions.
     * Anything that isn't an ingredient or a step. Plain text for now;
     * preserve user-entered line breaks when rendering.
     */
    notes: text("notes"),
    sourceUrl: text("sourceUrl"),

    prepMinutes: integer("prepMinutes"),
    cookMinutes: integer("cookMinutes"),
    servings: text("servings"),

    mealType: text("mealType", { enum: MEAL_TYPES }),
    cuisine: text("cuisine"),
    diets: text("diets", { mode: "json" }).$type<string[]>().default([]),

    visibility: text("visibility", { enum: VISIBILITY })
      .notNull()
      .default("public"),
    kind: text("kind", { enum: RECIPE_KIND }).notNull().default("structured"),

    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("recipes_author_idx").on(t.authorId),
    index("recipes_visibility_idx").on(t.visibility),
    index("recipes_meal_type_idx").on(t.mealType),
    unique("recipes_author_slug_unq").on(t.authorId, t.slug),
  ],
);

export const recipePhotos = sqliteTable(
  "recipePhotos",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    recipeId: text("recipeId")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    path: text("path").notNull(),
    blurhash: text("blurhash"),
    width: integer("width"),
    height: integer("height"),
    role: text("role", { enum: PHOTO_ROLES }).notNull().default("cover"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("recipe_photos_recipe_idx").on(t.recipeId, t.position),
    // Hero queries (feed, profile, search, collection covers) only
    // care about cover photos; an (recipeId, role) index lets the
    // planner skip source rows without scanning the position one.
    index("recipe_photos_recipe_role_idx").on(t.recipeId, t.role),
  ],
);

export const recipeIngredients = sqliteTable(
  "recipeIngredients",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    recipeId: text("recipeId")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    quantity: text("quantity"),
    unit: text("unit"),
    name: text("name").notNull(),
    note: text("note"),
  },
  (t) => [index("recipe_ingredients_recipe_idx").on(t.recipeId, t.position)],
);

export const recipeSteps = sqliteTable(
  "recipeSteps",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    recipeId: text("recipeId")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    body: text("body").notNull(),
  },
  (t) => [index("recipe_steps_recipe_idx").on(t.recipeId, t.position)],
);

export const tags = sqliteTable("tags", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
});

export const recipeTags = sqliteTable(
  "recipeTags",
  {
    recipeId: text("recipeId")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    tagId: text("tagId")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.recipeId, t.tagId] })],
);

export const collections = sqliteTable(
  "collections",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ownerId: text("ownerId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    coverPhotoPath: text("coverPhotoPath"),
    visibility: text("visibility", { enum: VISIBILITY })
      .notNull()
      .default("public"),
    isDefaultSaves: integer("isDefaultSaves", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    unique("collections_owner_slug_unq").on(t.ownerId, t.slug),
    index("collections_owner_idx").on(t.ownerId),
  ],
);

export const collectionRecipes = sqliteTable(
  "collectionRecipes",
  {
    collectionId: text("collectionId")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    recipeId: text("recipeId")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    addedAt: integer("addedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.recipeId] }),
    index("collection_recipes_recipe_idx").on(t.recipeId),
  ],
);

export const saves = sqliteTable(
  "saves",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipeId: text("recipeId")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    savedAt: integer("savedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.recipeId] }),
    index("saves_recipe_idx").on(t.recipeId),
  ],
);

/**
 * AI usage ledger.
 *
 * One row per /api/extract call (success or schema-validation failure
 * — both billed by OpenAI). We keep it append-only so the spend cap
 * is never blurred by an in-flight retry.
 *
 * - `userId` is required: anonymous extraction is not supported.
 * - `recipeId` is set when the user actually saves the extraction;
 *    null otherwise (extraction → user discarded the result).
 * - `costUsd` is denormalized so we don't have to re-do pricing math
 *    when OpenAI changes prices.
 */
export const aiUsage = sqliteTable(
  "aiUsage",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipeId: text("recipeId").references(() => recipes.id, {
      onDelete: "set null",
    }),
    model: text("model").notNull(),
    inputTokens: integer("inputTokens").notNull(),
    outputTokens: integer("outputTokens").notNull(),
    totalTokens: integer("totalTokens").notNull(),
    costUsd: real("costUsd").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("ai_usage_user_created_idx").on(t.userId, t.createdAt),
  ],
);

/**
 * 1-5 star rating, one row per (user, recipe). The author is allowed
 * to rate their OWN recipe — that's a self-bookmark, not a review,
 * and the UI hides their own star from the public average.
 */
export const recipeRatings = sqliteTable(
  "recipeRatings",
  {
    recipeId: text("recipeId")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    value: integer("value").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.recipeId, t.userId] }),
    index("recipe_ratings_recipe_idx").on(t.recipeId),
    index("recipe_ratings_user_idx").on(t.userId),
  ],
);

/**
 * Flat (no-thread) comments on a recipe. Soft delete is intentionally
 * skipped — `deleteRecipeAction` cascades, and a comment author or the
 * recipe owner can hard-delete a single comment via the action.
 */
export const recipeComments = sqliteTable(
  "recipeComments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    recipeId: text("recipeId")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    authorId: text("authorId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("recipe_comments_recipe_created_idx").on(t.recipeId, t.createdAt),
    index("recipe_comments_author_idx").on(t.authorId),
  ],
);

/**
 * User-owned shopping list. `archivedAt` is a soft "I'm done with this
 * trip" marker so old lists stay browsable but don't clutter the
 * default view.
 */
export const shoppingLists = sqliteTable(
  "shoppingLists",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ownerId: text("ownerId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    archivedAt: integer("archivedAt", { mode: "timestamp_ms" }),
  },
  (t) => [index("shopping_lists_owner_idx").on(t.ownerId, t.createdAt)],
);

/**
 * Items inside a shopping list. `sourceRecipeId` is set when the item
 * came from a recipe import (so the list can show "from Pad Thai")
 * and survives the recipe being deleted as `null`.
 *
 * Consolidation across recipes uses `(name, unit)` as the merge key —
 * see `lib/shopping/consolidate.ts`.
 */
export const shoppingListItems = sqliteTable(
  "shoppingListItems",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    listId: text("listId")
      .notNull()
      .references(() => shoppingLists.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    quantity: text("quantity"),
    unit: text("unit"),
    sourceRecipeId: text("sourceRecipeId").references(() => recipes.id, {
      onDelete: "set null",
    }),
    position: integer("position").notNull().default(0),
    checked: integer("checked", { mode: "boolean" }).notNull().default(false),
    addedAt: integer("addedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("shopping_list_items_list_idx").on(t.listId, t.position)],
);

/**
 * One row per browser/device that has opted in to push. Endpoint is
 * unique per device (the browser-issued URL the push service POSTs to)
 * and is the canonical handle we use for unsubscribe.
 */
export const pushSubscriptions = sqliteTable(
  "pushSubscriptions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dhKey: text("p256dhKey").notNull(),
    authKey: text("authKey").notNull(),
    userAgent: text("userAgent"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    lastSeenAt: integer("lastSeenAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("push_subscriptions_user_idx").on(t.userId)],
);

// Relations export shape kept loose for now; enable when needed for query helpers.
export const schemaTables = {
  users,
  accounts,
  sessions,
  verificationTokens,
  authenticators,
  recipes,
  recipePhotos,
  recipeIngredients,
  recipeSteps,
  tags,
  recipeTags,
  collections,
  collectionRecipes,
  saves,
  aiUsage,
  recipeRatings,
  recipeComments,
  shoppingLists,
  shoppingListItems,
  pushSubscriptions,
};

export const FTS_TABLE_NAME = "recipes_fts";

// Raw SQL applied via a custom migration after Drizzle's schema migration runs.
// FTS5 mirrors title + description + ingredient text for fast search.
export const FTS_SETUP_SQL = sql`
  CREATE VIRTUAL TABLE IF NOT EXISTS ${sql.raw(FTS_TABLE_NAME)}
    USING fts5(recipe_id UNINDEXED, title, description, ingredients);
`;
