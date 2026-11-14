/** The persisted todo list of the offline example (shared with runtime.ts). */
import { Mutation, Query } from "@effect-atom-query/react";
import { Schema } from "effect";
import { Api, type Todo } from "../api.ts";

const TodoSchema = Schema.Struct({ id: Schema.Number, text: Schema.String });

const todosQuery = Query.single({
  key: ["todos", "offline"],
  run: Api.use((api) => api.todos("offline")),
  staleTime: "30 seconds",
  gcTime: "24 hours",
  // Opt in to persistence: restored data is decoded with this schema.
  persist: { schema: Schema.Array(TodoSchema) },
});

/** Registered with QueryPersister.layer in runtime.ts, so it can resume after a reload. */
export const addOfflineTodo = Mutation.make({
  key: ["todos", "offline", "add"],
  run: (text: string) => Api.use((api) => api.addTodo("offline", text)),
  invalidates: [["todos", "offline"]],
  persist: { variables: Schema.String },
});

export const optimisticTodos = Mutation.optimistic(
  todosQuery,
  addOfflineTodo,
  (todos, text): ReadonlyArray<Todo> => [...todos, { id: -1, text }],
);
