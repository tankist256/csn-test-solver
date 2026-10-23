import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: "solver",
  base: "./",
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve("solver/index.html"),
        app: path.resolve("solver/src/main.jsx"),
      },
      output: { entryFileNames: "assets/[name]-[hash].js" },
    },
  },
});
