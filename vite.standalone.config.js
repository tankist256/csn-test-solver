import { defineConfig } from "vite";

export default defineConfig({
  root: "solver",
  base: "./",
  configFile: false,
  publicDir: false,
  build: {
    outDir: "dist/standalone",
    emptyOutDir: true,
    lib: {
      entry: "src/main.jsx",
      name: "CSDDTheorySolver",
      formats: ["iife"],
      fileName: () => "standalone.js",
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
