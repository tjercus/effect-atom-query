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
    },
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
  },
});
