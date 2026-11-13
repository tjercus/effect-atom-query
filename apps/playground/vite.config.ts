import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Resolve workspace packages to their TypeScript sources during development.
    conditions: ["@effect-native-query/source", ...defaultClientConditions],
  },
});
