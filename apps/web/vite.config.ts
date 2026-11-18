import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// The repo's .env, so the dev server honours the same settings as the other
// two processes. Real environment variables still win.
const repoEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env");
if (fs.existsSync(repoEnv)) {
  try {
    process.loadEnvFile(repoEnv);
  } catch {
    // Malformed .env — fall back to the ambient environment.
  }
}

/**
 * main.tsx loads the language before it imports the app, so the app's chunk
 * is only asked for once the entry has run: one round trip after another.
 * A modulepreload for that chunk (and the chunks it imports) in the page
 * fetches them alongside the entry. Preloading only downloads and parses: the
 * app still runs after the language is in.
 */
function preloadApp(): Plugin {
  return {
    name: "zelyq:preload-app",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return [];
        const app = Object.values(bundle).find(
          (chunk) => chunk.type === "chunk" && chunk.facadeModuleId?.endsWith("/src/App.tsx"),
        );
        if (!app || app.type !== "chunk") return [];
        const files = new Set<string>([app.fileName]);
        for (const name of app.imports) files.add(name);
        return [...files]
          .filter((file) => !(bundle[file]?.type === "chunk" && bundle[file].isEntry))
          .map((file) => ({
            tag: "link",
            attrs: { rel: "modulepreload", crossorigin: true, href: `/${file}` },
            injectTo: "head" as const,
          }));
      },
    },
  };
}

const SERVER = process.env.ZELYQ_SERVER_URL ?? "http://127.0.0.1:8787";

// In development the SPA runs on its own port and proxies to the API, so there
// is no CORS story to get wrong. In production the server serves this build.
export default defineConfig({
  plugins: [react(), tailwindcss(), preloadApp()],
  server: {
    // Bind IPv4 explicitly. Vite's default resolves to ::1 only on some hosts,
    // which breaks IPv4 clients and editor/SSH port forwarding. Set
    // ZELYQ_WEB_HOST=0.0.0.0 to reach the dev server from another machine.
    host: process.env.ZELYQ_WEB_HOST ?? "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": { target: SERVER, changeOrigin: true },
      "/ws": { target: SERVER, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
