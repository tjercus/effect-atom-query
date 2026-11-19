import { Mutation, Query, useMutation, useQuery } from "@effect-atom-query/react";
import { Option } from "effect";
import { useState } from "react";
import { Api } from "../api.ts";
import { type Example } from "../ui.tsx";

const todosQuery = Query.single({
  key: ["todos", "auto"],
  run: Api.use((api) => api.todos("auto")),
});

const addTodo = Mutation.make({
  key: ["todos", "auto", "add"],
  run: (text: string) => Api.use((api) => api.addTodo("auto", text)),
  invalidates: [["todos", "auto"]],
});

const clearTodos = Mutation.make({
  key: ["todos", "auto", "clear"],
  run: () => Api.use((api) => api.clearTodos("auto")),
  invalidates: [["todos", "auto"]],
});

function AutoRefetching() {
  const [intervalMs, setIntervalMs] = useState(1000);
  const [text, setText] = useState("");
  // Polling is a per-component option: unmount and it stops.
  const todos = useQuery(todosQuery, { refetchInterval: `${intervalMs} millis` });
  const add = useMutation(addTodo, { onSuccess: () => setText("") });
  const clear = useMutation(clearTodos);

  return (
    <div>
      <p>
        This list refetches every interval (paused while the tab is hidden).{" "}
        <span className={todos.isFetching ? "fetch-dot on" : "fetch-dot"} />
      </p>
      <label>
        Query interval speed (ms):{" "}
        <input
          type="number"
          min={100}
          step={100}
          value={intervalMs}
          onChange={(e) => setIntervalMs(Math.max(100, Number(e.target.value)))}
          style={{ width: 80 }}
        />
      </label>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() !== "") {
            add.mutate(text.trim());
          }
        }}
      >
        <input aria-label="todo" value={text} onChange={(e) => setText(e.target.value)} />{" "}
        <button disabled={add.isPending}>Add</button>
      </form>
      <ul>
        {Option.match(todos.data, {
          onNone: () => [],
          onSome: (list) => list.map((todo) => <li key={todo.id}>{todo.text}</li>),
        })}
      </ul>
      <button onClick={() => clear.mutate()} disabled={clear.isPending}>
        Clear All
      </button>
    </div>
  );
}

export const example: Example = {
  id: "auto-refetching",
  title: "Auto refetching / polling",
  tanstack: "auto-refetching",
  description: "refetchInterval as a component option, plus mutations that invalidate.",
  Component: AutoRefetching,
};
