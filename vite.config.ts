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
    // Keep vitest defaults and skip upstream reference checkouts (see AGENTS.md).
    exclude: ["**/node_modules/**", "**/.git/**", "docs/repos/**"],
  },
  run: {
    cache: true,
  },
});
