import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: {
    host: process.env.HOST || "127.0.0.1",
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
    proxy: { "/api": { target: process.env.ZELYQ_API_TARGET || "http://127.0.0.1:8000" } },
  },
});
