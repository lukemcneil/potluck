import { defineConfig } from "drizzle-kit";
import path from "node:path";

const dataDir = process.env.POTLUCK_DATA_DIR ?? "./data";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: path.join(dataDir, "potluck.db"),
  },
  verbose: true,
  strict: true,
});
