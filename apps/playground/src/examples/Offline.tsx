import {
  OnlineManager,
  useIsMutating,
  useIsRestoring,
  useMutation,
} from "@effect-native-query/react";
import { useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { useState, useSyncExternalStore } from "react";
import type { Todo } from "../api.ts";
import { addOfflineTodo, optimisticTodos } from "./offlineTodos.ts";
import { runtime } from "../runtime.ts";
import type { Example } from "../ui.tsx";

/** The client's online manager (the browser default, resolved from the runtime). */
const online = runtime.runSync(OnlineManager.OnlineManager);

function Offline() {
  const [text, setText] = useState("");
  const isRestoring = useIsRestoring();
  const todos = useAtomValue(optimisticTodos);
  const add = useMutation(addOfflineTodo, { onSuccess: () => setText("") });
  const pending = useIsMutating({ mutationKey: ["todos", "offline"] });
  const isOnline = useSyncExternalStore(
    (onChange) => online.subscribe(onChange),
    () => online.isOnline(),
  );

  return (
    <div>
      <p>
        The list is persisted to localStorage and restored on reload. Go offline (the button
        simulates it; the browser's network toggle works too) and add todos: they pause, are
        persisted, and resume when you are back online, even after a reload.
      </p>
      <p>
        Network: <strong data-testid="network">{isOnline ? "online" : "offline"}</strong>{" "}
        <button onClick={() => runtime.runFork(OnlineManager.setOnline(!isOnline))}>
          Go {isOnline ? "offline" : "online"}
        </button>
        {isRestoring ? " · restoring cache…" : ""}
        {pending > 0 ? ` · ${pending} pending` : ""}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() !== "") add.mutate(text.trim());
        }}
      >
        <input aria-label="todo" value={text} onChange={(e) => setText(e.target.value)} />{" "}
        <button>Add</button>
      </form>
      <ul data-testid="offline-todos">
        {Option.getOrElse(todos.data, (): ReadonlyArray<Todo> => []).map((todo, i) => (
          <li key={`${todo.id}-${i}`} style={{ opacity: todo.id === -1 ? 0.5 : 1 }}>
            {todo.text}
          </li>
        ))}
      </ul>
      {add.isPaused ? <p>Paused until the network is back.</p> : null}
    </div>
  );
}

export const example: Example = {
  id: "offline",
  title: "Offline & persistence",
  tanstack: "offline",
  description: "QueryPersister with schema-typed persistence, paused and resumed mutations.",
  Component: Offline,
};
