import { cleanup } from "@testing-library/react";
import { afterEach } from "vite-plus/test";

// Vitest globals are off, so testing-library cannot register its own cleanup.
afterEach(() => {
  cleanup();
});
