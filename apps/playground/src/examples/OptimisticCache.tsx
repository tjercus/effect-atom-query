import {
  Mutation,
  Query,
  QueryClient,
  QueryResult,
  useMutation,
  useQuery,
} from "@effect-atom-query/react";
import { Effect, Option } from "effect";
import { useState } from "react";
import { Api, type Todo } from "../api.ts";
import { errorMessage, type Example, StaleDataError, Status } from "../ui.tsx";

const todosQuery = Query.single({
  key: ["todos", "optimistic-cache"],
  run: Api.use((api) => api.todos("optimistic-cache")),
});

// Optimistic updates written to the cache, with rollback: the callbacks are
// plain Effects with the QueryClient in context.
const addTodo = Mutation.make({
  key: ["todos", "optimistic-cache", "add"],
  run: (text: string) => Api.use((api) => api.addTodo("optimistic-cache", text)),
  onMutate: (text) =>
    Effect.gen(function* () {
      const client = yield* QueryClient.QueryClient;
      // Don't let an in-flight refetch overwrite the optimistic list.
      yield* client.cancelQueries({ queryKey: todosQuery.key });
      const previous = yield* client.getQueryData(todosQuery);
      yield* client.setQueryData(todosQuery, (todos) =>
        Option.map(todos, (list): ReadonlyArray<Todo> => [...list, { id: -1, text }]),
      );
      return previous; // the context passed to onError
    }),
  onError: (_cause, _text, previous) =>
    QueryClient.QueryClient.pipe(
      Effect.flatMap((client) => client.setQueryData(todosQuery, () => Option.flatten(previous))),
    ),
  // Refetch after success or failure, to be in sync with the server.
  onSettled: () =>
    QueryClient.QueryClient.pipe(
      Effect.flatMap((client) => client.invalidateQueries({ queryKey: todosQuery.key })),
    ),
});

function OptimisticCache() {
  const [text, setText] = useState("");
  const todos = useQuery(todosQuery);
  const add = useMutation(addTodo, { onSuccess: () => setText("") });
  const view = (list: ReadonlyArray<Todo>) => (
    <ul>
      {list.map((todo, i) => (
        <li key={`${todo.id}-${i}`} style={{ opacity: todo.id === -1 ? 0.5 : 1 }}>
          {todo.text}
        </li>
      ))}
    </ul>
  );

  return (
    <div>
      <p>
        The new todo is written into the cache immediately and rolled back if the server rejects it
        (try a text containing "fail").
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() !== "") {
            add.mutate(text.trim());
          }
        }}
      >
        <input aria-label="todo" value={text} onChange={(e) => setText(e.target.value)} />{" "}
        <button disabled={add.isPending}>Create</button>
      </form>
      {QueryResult.match(todos, {
        onPending: () => <p>Loading...</p>,
        // A failed refetch keeps the list it already has.
        onFailure: (failure) =>
          Option.match(failure.data, {
            onNone: () => <p>Error: {errorMessage(failure)}</p>,
            onSome: (list) => (
              <>
                {view(list)}
                <StaleDataError failure={failure} />
              </>
            ),
          }),
        onSuccess: (success) => view(success.data.value),
      })}
      {add.isError ? (
        <p style={{ color: "#dc2626" }}>
          {Option.match(add.error, { onNone: () => "Something broke", onSome: (e) => e.message })} —
          rolled back.
        </p>
      ) : null}
      <Status result={todos} />
    </div>
  );
}

export const example: Example = {
  id: "optimistic-cache",
  title: "Optimistic updates (cache)",
  tanstack: "optimistic-updates-cache",
  description: "onMutate / onError / onSettled as Effects: snapshot, write, roll back, refetch.",
  Component: OptimisticCache,
};
