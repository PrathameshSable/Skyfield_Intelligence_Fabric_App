import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Keep node_modules external — this is a service, not a library bundle.
  skipNodeModulesBundle: true,
});
