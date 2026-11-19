import { Mutation, Query, QueryResult, useMutation } from "@effect-atom-query/react";
import { useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { useState } from "react";
import { Api, type Todo } from "../api.ts";
import { errorMessage, type Example } from "../ui.tsx";

const todosQuery = Query.single({
  key: ["todos", "optimistic-ui"],
  run: Api.use((api) => api.todos("optimistic-ui")),
});

const addTodo = Mutation.make({
  key: ["todos", "optimistic-ui", "add"],
  run: (text: string) => Api.use((api) => api.addTodo("optimistic-ui", text)),
  // Pending until the list has refetched, so the overlay hands over seamlessly.
  invalidates: [["todos", "optimistic-ui"]],
});

// The list with every pending addition appended. Nothing touches the cache,
// so nothing has to be rolled back: a failed addition simply disappears.
const optimisticTodos = Mutation.optimistic(
  todosQuery,
  addTodo,
  (todos, text): ReadonlyArray<Todo> => [...todos, { id: -1, text }],
);

function TodoList({ todos }: { readonly todos: ReadonlyArray<Todo> }) {
  return (
    <ul>
      {todos.map((todo, i) => (
        <li key={`${todo.id}-${i}`} style={{ opacity: todo.id === -1 ? 0.5 : 1 }}>
          {todo.text}
        </li>
      ))}
    </ul>
  );
}

function OptimisticUi() {
  const [text, setText] = useState("");
  const todos = useAtomValue(optimisticTodos);
  const add = useMutation(addTodo, { onSuccess: () => setText("") });

  return (
    <div>
      <p>
        Pending todos are shown greyed out straight from the mutation's variables. Texts containing
        "fail" are rejected by the server.
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
        <button>Create</button>
      </form>
      {QueryResult.match(todos, {
        onPending: () => <p>Loading...</p>,
        // A failed refetch keeps the list; a failed first load has none to show.
        onFailure: (failure) =>
          Option.match(failure.data, {
            onNone: () => <p>Error: {errorMessage(failure)}</p>,
            onSome: (list) => <TodoList todos={list} />,
          }),
        onSuccess: (success) => <TodoList todos={success.data.value} />,
      })}
      {add.isError && Option.isSome(add.variables) ? (
        <p style={{ color: "#dc2626" }}>
          {Option.match(add.error, { onNone: () => "Something broke", onSome: (e) => e.message })}{" "}
          <button onClick={() => add.mutate(add.variables.value)}>Retry</button>
        </p>
      ) : null}
    </div>
  );
}

export const example: Example = {
  id: "optimistic-ui",
  title: "Optimistic updates (UI)",
  tanstack: "optimistic-updates-ui",
  description: "Mutation.optimistic overlays pending mutation variables on a query.",
  Component: OptimisticUi,
};
