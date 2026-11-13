import { Mutation, Query, useIsMutating, useMutation } from "@effect-native-query/react";
import { useAtomValue } from "@effect/atom-react";
import { Effect, Option, Schema } from "effect";
import { useState } from "react";

class TitleRejected extends Schema.TaggedError<TitleRejected>()("TitleRejected", {
  title: Schema.String,
}) {}

// A fake server: 600 ms latency; titles containing "fail" are rejected.
let serverTodos: ReadonlyArray<string> = ["learn Effect"];

const todosQuery = Query.single({
  key: ["todos"],
  run: Effect.sync(() => serverTodos).pipe(Effect.delay("300 millis")),
  staleTime: "30 seconds",
  gcTime: "24 hours",
  // Survives reloads (see main.tsx): restored data is decoded with this schema.
  persist: { schema: Schema.Array(Schema.String) },
});

export const addTodo = Mutation.make({
  key: ["todos", "add"],
  run: (title: string) =>
    Effect.gen(function* () {
      yield* Effect.sleep("600 millis");
      if (title.includes("fail")) return yield* new TitleRejected({ title });
      serverTodos = [...serverTodos, title];
      return title;
    }),
  invalidates: [["todos"]],
  // Added while offline and then reloaded? It is stored and resumed.
  persist: { variables: Schema.String },
});

// Pending additions shown immediately, greyed out; nothing to roll back.
const optimisticTodos = Mutation.optimistic(todosQuery, addTodo, (todos, title) => [
  ...todos,
  `${title} (saving…)`,
]);

export function Todos() {
  const [title, setTitle] = useState("");
  const todos = useAtomValue(optimisticTodos);
  const add = useMutation(addTodo, { onSuccess: () => setTitle("") });
  const saving = useIsMutating({ mutationKey: ["todos"] });

  return (
    <section>
      <h2>Todos {saving > 0 ? `(saving ${saving})` : ""}</h2>
      <ul data-testid="todos">
        {Option.getOrElse(todos.data, () => [] as ReadonlyArray<string>).map((todo, i) => (
          <li key={`${todo}-${i}`} style={{ opacity: todo.endsWith("(saving…)") ? 0.5 : 1 }}>
            {todo}
          </li>
        ))}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim() !== "") add.mutate(title.trim());
        }}
      >
        <input aria-label="title" value={title} onChange={(e) => setTitle(e.target.value)} />{" "}
        <button type="submit">add</button>
      </form>
      {add.isError ? (
        <p role="alert">
          rejected: {Option.match(add.error, { onNone: () => "defect", onSome: (e) => e.title })}
        </p>
      ) : null}
    </section>
  );
}
