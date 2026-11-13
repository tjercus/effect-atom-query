import { QueryClient, QueryClientProvider } from "@effect-native-query/react";
import { ManagedRuntime } from "effect";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

const runtime = ManagedRuntime.make(QueryClient.layer());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider runtime={runtime}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
