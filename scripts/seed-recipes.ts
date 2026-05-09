/**
 * Seed a handful of demo recipes against the FIRST user in the DB.
 *
 *   pnpm db:seed
 *
 * Idempotent on slug: re-running won't duplicate recipes (slugs are unique
 * per-author, so the inserts will conflict and be skipped).
 *
 * Photos are auto-generated with sharp as warm gradient SVGs converted to
 * jpeg, so we stay zero-dependency-on-the-network.
 */

import "dotenv/config";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, and } from "drizzle-orm";
import sharp from "sharp";
import { nanoid } from "nanoid";
import fs from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import * as schema from "../db/schema";

const dataDir = path.resolve(process.env.POTLUCK_DATA_DIR ?? "./data");
const dbPath = path.join(dataDir, "potluck.db");
const uploadsDir = path.join(dataDir, "uploads");
if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });

const RECIPES: Array<{
  title: string;
  slug: string;
  description: string;
  prepMinutes: number;
  cookMinutes: number;
  servings: string;
  mealType: schema.MealType;
  cuisine: string;
  diets: string[];
  visibility: "public" | "unlisted" | "private";
  tags: string[];
  ingredients: Array<{
    quantity?: string;
    unit?: string;
    name: string;
    note?: string;
  }>;
  steps: string[];
  /** [color1, color2] for the placeholder gradient. */
  palette: [string, string];
}> = [
  {
    title: "Grandma's Apple Pie",
    slug: "grandmas-apple-pie",
    description: "A flaky, buttery classic with cinnamon-spiced apples.",
    prepMinutes: 30,
    cookMinutes: 60,
    servings: "8",
    mealType: "dessert",
    cuisine: "american",
    diets: ["vegetarian"],
    visibility: "public",
    tags: ["fall", "make-ahead", "comfort-food"],
    ingredients: [
      { quantity: "2", unit: "cups", name: "all-purpose flour" },
      { quantity: "1", unit: "tsp", name: "salt" },
      { quantity: "1", unit: "cup", name: "cold butter", note: "cubed" },
      { quantity: "6", unit: "cups", name: "granny smith apples", note: "peeled and sliced" },
      { quantity: "3/4", unit: "cup", name: "sugar" },
      { quantity: "2", unit: "tbsp", name: "cinnamon" },
      { quantity: "2", unit: "tbsp", name: "lemon juice" },
    ],
    steps: [
      "Mix flour and salt. Cut in butter until pea-sized.",
      "Add ice water a tablespoon at a time until dough comes together. Chill 30 minutes.",
      "Toss apples with sugar, cinnamon, and lemon juice.",
      "Roll dough, line pie plate, fill with apples, top with second crust.",
      "Bake at 425°F for 20 min, then reduce to 350°F for 40 minutes more.",
      "Cool 1 hour before serving.",
    ],
    palette: ["#E07A5F", "#F2CC8F"],
  },
  {
    title: "30-Minute Weeknight Pad Thai",
    slug: "30-minute-pad-thai",
    description: "Sweet, savory, sour, and just the right amount of crunch.",
    prepMinutes: 10,
    cookMinutes: 20,
    servings: "4",
    mealType: "dinner",
    cuisine: "thai",
    diets: ["dairy-free"],
    visibility: "public",
    tags: ["weeknight", "30-min", "one-pan"],
    ingredients: [
      { quantity: "8", unit: "oz", name: "rice noodles" },
      { quantity: "3", unit: "tbsp", name: "fish sauce" },
      { quantity: "3", unit: "tbsp", name: "tamarind paste" },
      { quantity: "3", unit: "tbsp", name: "brown sugar" },
      { quantity: "12", unit: "oz", name: "shrimp", note: "or chicken / tofu" },
      { quantity: "2", unit: "", name: "eggs", note: "beaten" },
      { quantity: "2", unit: "cups", name: "bean sprouts" },
      { quantity: "1/2", unit: "cup", name: "roasted peanuts", note: "chopped" },
      { quantity: "3", unit: "", name: "scallions", note: "sliced" },
    ],
    steps: [
      "Soak noodles in hot water until pliable. Drain.",
      "Whisk fish sauce, tamarind, and brown sugar. Set aside.",
      "Sear shrimp in a hot wok with oil for 2 minutes; remove.",
      "Push to side, scramble eggs, then add noodles and sauce. Toss for 2 minutes.",
      "Return shrimp, add sprouts and scallions. Plate and top with peanuts.",
    ],
    palette: ["#C2462C", "#F2A65A"],
  },
  {
    title: "No-Knead Sourdough Focaccia",
    slug: "no-knead-focaccia",
    description: "Crispy, golden, dimpled. Olive oil and flaky salt do the heavy lifting.",
    prepMinutes: 15,
    cookMinutes: 25,
    servings: "1 sheet pan",
    mealType: "side",
    cuisine: "italian",
    diets: ["vegan"],
    visibility: "public",
    tags: ["bread", "weekend", "make-ahead"],
    ingredients: [
      { quantity: "500", unit: "g", name: "bread flour" },
      { quantity: "400", unit: "g", name: "warm water" },
      { quantity: "100", unit: "g", name: "active sourdough starter" },
      { quantity: "12", unit: "g", name: "salt" },
      { quantity: "1/4", unit: "cup", name: "olive oil", note: "plus more for the pan" },
      { quantity: "", unit: "", name: "flaky sea salt", note: "for finishing" },
      { quantity: "", unit: "", name: "fresh rosemary", note: "optional" },
    ],
    steps: [
      "Stir together flour, water, starter, and salt until shaggy. Cover.",
      "Stretch and fold every 30 minutes for 2 hours.",
      "Cold-ferment overnight in the fridge (8–12h).",
      "Pour into an oiled sheet pan. Stretch to corners. Rise 1.5h.",
      "Dimple with oily fingers. Top with rosemary and flaky salt.",
      "Bake at 475°F for 22–25 minutes until deep golden.",
    ],
    palette: ["#D4A056", "#FAF6EF"],
  },
  {
    title: "Smashburger Tacos",
    slug: "smashburger-tacos",
    description: "Burger meets taco. Crispy edges, melty cheese, special sauce.",
    prepMinutes: 10,
    cookMinutes: 15,
    servings: "4",
    mealType: "dinner",
    cuisine: "american",
    diets: [],
    visibility: "public",
    tags: ["weeknight", "kid-friendly", "smash"],
    ingredients: [
      { quantity: "1", unit: "lb", name: "ground beef", note: "80/20" },
      { quantity: "8", unit: "", name: "small flour tortillas" },
      { quantity: "8", unit: "slices", name: "american cheese" },
      { quantity: "1/4", unit: "cup", name: "mayo" },
      { quantity: "2", unit: "tbsp", name: "ketchup" },
      { quantity: "1", unit: "tbsp", name: "yellow mustard" },
      { quantity: "1", unit: "tbsp", name: "dill pickle relish" },
      { quantity: "1", unit: "cup", name: "shredded iceberg" },
      { quantity: "1/2", unit: "cup", name: "diced white onion" },
    ],
    steps: [
      "Whisk mayo, ketchup, mustard, and relish for the sauce.",
      "Heat a cast iron skillet screaming hot.",
      "Roll beef into 2 oz balls; place on a tortilla and smash flat.",
      "Cook tortilla-side down 2 minutes; flip, season, top with cheese.",
      "Fold tacos. Serve with lettuce, onion, and special sauce.",
    ],
    palette: ["#9C2A0E", "#E07A5F"],
  },
  {
    title: "Citrus & Avocado Salad",
    slug: "citrus-avocado-salad",
    description: "Bright, peppery, refreshing. The recipe-card kind of side dish.",
    prepMinutes: 15,
    cookMinutes: 0,
    servings: "4",
    mealType: "side",
    cuisine: "mediterranean",
    diets: ["vegan", "gluten-free", "dairy-free"],
    visibility: "public",
    tags: ["winter", "5-ingredient", "no-cook"],
    ingredients: [
      { quantity: "2", unit: "", name: "blood oranges", note: "supremed" },
      { quantity: "1", unit: "", name: "grapefruit", note: "supremed" },
      { quantity: "2", unit: "", name: "ripe avocados", note: "sliced" },
      { quantity: "2", unit: "cups", name: "arugula" },
      { quantity: "3", unit: "tbsp", name: "olive oil" },
      { quantity: "1", unit: "tbsp", name: "white wine vinegar" },
      { quantity: "", unit: "", name: "flaky salt and pepper" },
    ],
    steps: [
      "Arrange arugula on a platter. Top with citrus segments and avocado.",
      "Whisk olive oil and vinegar. Drizzle.",
      "Finish with flaky salt and lots of black pepper.",
    ],
    palette: ["#5A8F3D", "#F2CC8F"],
  },
  {
    title: "Brown Butter Chocolate Chip Cookies",
    slug: "brown-butter-cookies",
    description: "Toasty, nutty, with crackly tops and gooey middles.",
    prepMinutes: 20,
    cookMinutes: 12,
    servings: "24 cookies",
    mealType: "dessert",
    cuisine: "american",
    diets: ["vegetarian"],
    visibility: "public",
    tags: ["dessert", "weekend", "make-ahead"],
    ingredients: [
      { quantity: "1", unit: "cup", name: "butter" },
      { quantity: "1", unit: "cup", name: "brown sugar" },
      { quantity: "1/2", unit: "cup", name: "white sugar" },
      { quantity: "2", unit: "", name: "eggs" },
      { quantity: "2", unit: "tsp", name: "vanilla" },
      { quantity: "2 1/4", unit: "cups", name: "all-purpose flour" },
      { quantity: "1", unit: "tsp", name: "baking soda" },
      { quantity: "1", unit: "tsp", name: "kosher salt" },
      { quantity: "12", unit: "oz", name: "chocolate", note: "chopped" },
      { quantity: "", unit: "", name: "flaky salt", note: "for topping" },
    ],
    steps: [
      "Brown butter in a saucepan until amber and nutty. Cool slightly.",
      "Whisk butter with both sugars, then eggs and vanilla.",
      "Fold in flour, baking soda, salt. Stir in chocolate.",
      "Chill dough at least 1 hour (overnight is better).",
      "Scoop onto sheet pans, top with flaky salt.",
      "Bake at 375°F for 11–13 minutes until edges are set.",
    ],
    palette: ["#6B3410", "#E07A5F"],
  },
];

async function makeHeroPhoto(palette: [string, string], title: string) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${palette[0]}" />
          <stop offset="100%" stop-color="${palette[1]}" />
        </linearGradient>
      </defs>
      <rect width="1200" height="900" fill="url(#g)" />
      <text x="60" y="820" font-family="Georgia, serif" font-size="48" fill="rgba(255,255,255,0.85)" font-style="italic">${escapeXml(title)}</text>
    </svg>
  `;

  const buffer = await sharp(Buffer.from(svg))
    .jpeg({ quality: 85 })
    .toBuffer();
  const placeholder = await sharp(buffer)
    .resize({ width: 16 })
    .jpeg({ quality: 50 })
    .toBuffer();
  const meta = await sharp(buffer).metadata();
  const id = nanoid(16);
  const filename = `${id}.jpg`;
  await fs.writeFile(path.join(uploadsDir, filename), buffer);
  return {
    publicPath: `/uploads/${filename}`,
    width: meta.width ?? 1200,
    height: meta.height ?? 900,
    blurhash: `data:image/jpeg;base64,${placeholder.toString("base64")}`,
  };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function main() {
  const owner = db.select().from(schema.users).get();
  if (!owner) {
    console.error("No user found. Sign in first via the app, then re-run pnpm db:seed.");
    process.exitCode = 1;
    return;
  }
  console.log(`Seeding for user @${owner.handle ?? owner.id} (${owner.email})`);

  let inserted = 0;
  let skipped = 0;
  for (const r of RECIPES) {
    const existing = db
      .select({ id: schema.recipes.id })
      .from(schema.recipes)
      .where(
        and(
          eq(schema.recipes.authorId, owner.id),
          eq(schema.recipes.slug, r.slug),
        ),
      )
      .get();
    if (existing) {
      skipped += 1;
      continue;
    }

    const recipeId = crypto.randomUUID();
    const photo = await makeHeroPhoto(r.palette, r.title);
    const now = new Date();

    db.transaction((tx) => {
      tx.insert(schema.recipes)
        .values({
          id: recipeId,
          authorId: owner.id,
          title: r.title,
          slug: r.slug,
          description: r.description,
          prepMinutes: r.prepMinutes,
          cookMinutes: r.cookMinutes,
          servings: r.servings,
          mealType: r.mealType,
          cuisine: r.cuisine,
          diets: r.diets,
          visibility: r.visibility,
          kind: "structured",
          createdAt: now,
          updatedAt: now,
        })
        .run();

      tx.insert(schema.recipePhotos)
        .values({
          recipeId,
          position: 0,
          path: photo.publicPath,
          width: photo.width,
          height: photo.height,
          blurhash: photo.blurhash,
          createdAt: now,
        })
        .run();

      if (r.ingredients.length) {
        tx.insert(schema.recipeIngredients)
          .values(
            r.ingredients.map((ing, i) => ({
              recipeId,
              position: i,
              quantity: ing.quantity ?? null,
              unit: ing.unit ?? null,
              name: ing.name,
              note: ing.note ?? null,
            })),
          )
          .run();
      }

      if (r.steps.length) {
        tx.insert(schema.recipeSteps)
          .values(
            r.steps.map((body, i) => ({
              recipeId,
              position: i,
              body,
            })),
          )
          .run();
      }

      for (const tagName of r.tags) {
        const t = tagName.trim().toLowerCase();
        if (!t) continue;
        const existingTag = tx
          .select({ id: schema.tags.id })
          .from(schema.tags)
          .where(eq(schema.tags.name, t))
          .get();
        const tagId = existingTag?.id ?? crypto.randomUUID();
        if (!existingTag) {
          tx.insert(schema.tags).values({ id: tagId, name: t }).run();
        }
        tx.insert(schema.recipeTags)
          .values({ recipeId, tagId })
          .onConflictDoNothing()
          .run();
      }
    });

    inserted += 1;
    console.log(`  + ${r.title}`);
  }

  console.log(`\nDone. ${inserted} inserted, ${skipped} skipped (already present).`);
  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
