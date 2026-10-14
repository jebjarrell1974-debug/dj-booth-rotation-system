import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Homebase releases must be built from the saved, isolated producer tree.
// The release tool supplies this marker; direct builds cannot claim provenance.
if (process.env.DJBOOTH_PRODUCER_BUILD !== "1") {
  throw new Error("Use pnpm --filter @workspace/dj-booth run build:homebase to preserve and verify producer source");
}

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
  },
});
