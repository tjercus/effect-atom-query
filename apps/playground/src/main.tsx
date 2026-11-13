import { QueryClient, QueryClientProvider, QueryPersister } from "@effect-native-query/react";
import { Layer, ManagedRuntime } from "effect";
import { KeyValueStore } from "effect/persistence";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { addTodo } from "./Todos.tsx";

const runtime = ManagedRuntime.make(
  QueryPersister.layer({ buster: "playground-v1", mutations: [addTodo] }).pipe(
    Layer.provideMerge(QueryClient.layer()),
    Layer.provide(KeyValueStore.layerStorage(() => localStorage)),
  ),
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider runtime={runtime}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
