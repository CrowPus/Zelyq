import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema/sqlite.ts",
  out: "./drizzle/sqlite",
  dbCredentials: { url: process.env.DATABASE_URL ?? "file:../../data/zelyq.db" },
  strict: true,
  verbose: true,
});
