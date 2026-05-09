import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
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
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("recipe_photos_recipe_idx").on(t.recipeId, t.position)],
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
};

export const FTS_TABLE_NAME = "recipes_fts";

// Raw SQL applied via a custom migration after Drizzle's schema migration runs.
// FTS5 mirrors title + description + ingredient text for fast search.
export const FTS_SETUP_SQL = sql`
  CREATE VIRTUAL TABLE IF NOT EXISTS ${sql.raw(FTS_TABLE_NAME)}
    USING fts5(recipe_id UNINDEXED, title, description, ingredients);
`;
