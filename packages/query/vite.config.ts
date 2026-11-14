import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts"],
    dts: { generator: "tsgo" },
  },
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**"],
      thresholds: { statements: 90, branches: 90, functions: 90, lines: 90 },
    },
    include: ["test/**/*.test.ts"],
  },
});
