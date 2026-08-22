import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/pg.ts",
  out: "./drizzle/pg",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/zelyq",
  },
  strict: true,
  verbose: true,
});
