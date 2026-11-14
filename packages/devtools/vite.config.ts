import { defaultClientConditions, defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    // Resolve workspace packages to their TypeScript sources in tests.
    conditions: ["@effect-native-query/source", ...defaultClientConditions],
  },
  pack: {
    entry: ["src/index.ts"],
    dts: { generator: "tsgo" },
  },
  test: {
    environment: "happy-dom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["test/setup.ts"],
  },
});
