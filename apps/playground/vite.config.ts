import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite-plus";
import { quoteServer } from "./server/quotes.ts";

export default defineConfig({
  // The quote server backs the "Live updates" example.
  plugins: [react(), quoteServer()],
  resolve: {
    // Resolve workspace packages to their TypeScript sources during development.
    conditions: ["@effect-atom-query/source", ...defaultClientConditions],
  },
  test: {
    environment: "happy-dom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["test/setup.ts"],
  },
});
