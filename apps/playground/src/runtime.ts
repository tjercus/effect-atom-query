import { QueryClient, QueryPersister } from "@effect-atom-query/react";
import { Layer, ManagedRuntime } from "effect";
import { KeyValueStore } from "effect/persistence";
import { ApiLive } from "./api.ts";
import { addOfflineTodo } from "./examples/offlineTodos.ts";

/**
 * The app runtime: the fake `Api`, a `QueryClient`, and a persister writing
 * queries that opt in (`persist`) to localStorage.
 */
export const runtime = ManagedRuntime.make(
  QueryPersister.layer({ buster: "playground-v2", mutations: [addOfflineTodo] }).pipe(
    Layer.provideMerge(QueryClient.layer()),
    Layer.provideMerge(ApiLive),
    Layer.provide(KeyValueStore.layerStorage(() => localStorage)),
  ),
);
