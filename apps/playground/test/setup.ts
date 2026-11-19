import { cleanup } from "@testing-library/react";
import { afterEach } from "vite-plus/test";

afterEach(() => {
  // Vitest globals are off, so testing-library cannot register its own cleanup.
  cleanup();
  // The fake server keeps its todo lists in localStorage.
  localStorage.clear();
});
