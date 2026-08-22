import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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

const SERVER = process.env.ZELYQ_SERVER_URL ?? "http://127.0.0.1:8787";

// In development the SPA runs on its own port and proxies to the API, so there
// is no CORS story to get wrong. In production the server serves this build.
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
