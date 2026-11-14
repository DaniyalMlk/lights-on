import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// /api calls go to the FastAPI server.
// MapLibre's web worker is an ES module, so workers are built as ES modules too.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
  optimizeDeps: { exclude: ["maplibre-gl"] },
  worker: { format: "es" },
});
