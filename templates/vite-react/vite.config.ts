import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Zelyq assigns the port through PORT so several previews can run side by side.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Zelyq supplies HOST and PORT. HOST is loopback unless Zelyq itself runs
    // somewhere the viewer's browser has to reach over the network.
    host: process.env.HOST || "127.0.0.1",
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
  },
});
