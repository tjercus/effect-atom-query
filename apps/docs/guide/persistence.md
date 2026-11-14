# Persistence & offline

## Persisting queries

Persistence is **opt-in per query** and **typed**. A query declares the
`Schema` of its data:

```ts
const todosQuery = Query.single({
  key: ["todos"],
  run: TodoRepo.use((repo) => repo.list),
  gcTime: "24 hours", // keep it around at least as long as maxAge
  persist: { schema: Schema.Array(Todo) },
});
```

Add the persister layer on top of the client, with any `KeyValueStore`:

```ts
import { KeyValueStore } from "effect/persistence";

const runtime = ManagedRuntime.make(
  QueryPersister.layer({ buster: "v1" }).pipe(
    Layer.provideMerge(QueryClient.layer()),
    Layer.provide(KeyValueStore.layerStorage(() => localStorage)),
  ),
);
```

- Snapshots are written (throttled) as the cache changes, and once more when the
  runtime closes.
- On start, stored entries are kept as JSON and **decoded lazily with the
  query's own schema** the first time the query is used. `DateTime`, `Option`,
  branded and class types come back as real values. Data that no longer
  decodes (the schema changed) is dropped and refetched.
- `buster` invalidates every snapshot (bump it on deploys that change data
  shapes). `maxAge` (24 hours) discards old snapshots.

| option                  | default                 |
| ----------------------- | ----------------------- |
| `storageKey`            | `"effect-native-query"` |
| `buster`                | `""`                    |
| `maxAge`                | 24 hours                |
| `throttle`              | 1 second                |
| `restore`               | `"blocking"`            |
| `mutations`             | `[]`                    |
| `resumePausedMutations` | `true`                  |
| `shouldPersistQuery`    | successful queries      |

### Restore modes

- `"blocking"` restores while the layer is built. With synchronous storage
  (`localStorage`), the first render already has the data.
- `"background"` restores in a fiber, which suits IndexedDB or AsyncStorage.
  Until it finishes, `useIsRestoring()` is `true`, queries do not fetch on
  mount, and suspense hooks wait.

## Offline mutations

With the default `networkMode: "online"`, a mutation started while offline is
**paused** (`isPaused: true`) and continues when the connection returns. To
also survive a reload, persist its variables and list the mutation in the
persister. A `run` function cannot be stored, so the definition must be
registered:

```ts
const addTodo = Mutation.make({
  key: ["todos", "add"],
  run: (title: string) => TodoRepo.use((repo) => repo.add(title)),
  invalidates: [["todos"]],
  persist: { variables: Schema.String },
});

QueryPersister.layer({ buster: "v1", mutations: [addTodo] });
```

On the next start, the paused execution is restored and resumed once online.
`Mutation.optimistic` overlays keep showing it until it settles.

## Storage targets

Anything with a `KeyValueStore` layer works: `layerStorage` (localStorage,
sessionStorage), `layerMemory`, the file system, SQL, or a custom store such as
React Native's AsyncStorage.
