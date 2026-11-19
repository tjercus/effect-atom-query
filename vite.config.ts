import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: {
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "@stylistic", specifier: "@stylistic/eslint-plugin" },
    ],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      // One true brace style: https://eslint.style/rules/brace-style
      "@stylistic/brace-style": ["error", "1tbs"],
      curly: ["error", "all"],
    },
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    // Run each workspace package with its own config (environment, setup files,
    // resolve conditions), so a root `vp test` matches `vp run -r test`.
    // Projects do not inherit this root `test` config, and each sets its own
    // `test.include` under its own folder, so upstream checkouts in
    // `docs/repos` (see AGENTS.md) are never collected.
    projects: ["{packages,apps}/*/vite.config.ts"],
  },
  run: {
    cache: true,
  },
});
