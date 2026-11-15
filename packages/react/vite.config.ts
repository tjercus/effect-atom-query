import { defaultClientConditions, defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    // Resolve workspace packages to their TypeScript sources in tests.
    conditions: ["@effect-atom-query/source", ...defaultClientConditions],
  },
  pack: {
    entry: ["src/index.ts", "src/testing.tsx"],
    dts: { generator: "tsgo" },
  },
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**"],
      thresholds: { statements: 90, branches: 90, functions: 90, lines: 90 },
    },
    environment: "happy-dom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["test/setup.ts"],
  },
});
