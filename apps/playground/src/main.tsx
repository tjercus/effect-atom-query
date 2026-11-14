import { QueryClientProvider } from "@effect-atom-query/react";
import { QueryDevtools } from "@effect-atom-query/devtools";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { runtime } from "./runtime.ts";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider runtime={runtime}>
      <App />
      <QueryDevtools />
    </QueryClientProvider>
  </StrictMode>,
);
