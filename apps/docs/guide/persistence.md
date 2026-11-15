# Persistence & offline

## Persisting queries

Persistence is **opt-in per query** and **typed**. A query declares the
`Schema` of its data (an Effect Schema, or
[a zod, Valibot or ArkType schema](#with-zod-valibot-or-arktype)):

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

| option                  | default               |
| ----------------------- | --------------------- |
| `storageKey`            | `"effect-atom-query"` |
| `buster`                | `""`                  |
| `maxAge`                | 24 hours              |
| `throttle`              | 1 second              |
| `restore`               | `"blocking"`          |
| `mutations`             | `[]`                  |
| `resumePausedMutations` | `true`                |
| `shouldPersistQuery`    | successful queries    |

### With zod, Valibot or ArkType

`persist.schema` also takes any [Standard Schema](https://standardschema.dev)
validator, so an app that validates API data with zod does not need an Effect
Schema as well:

```ts
const Todo = z.object({ id: z.string(), title: z.string(), done: z.boolean() });

const todosQuery = Query.single({
  key: ["todos"],
  run: TodoRepo.use((repo) => repo.list),
  persist: { schema: z.array(Todo) },
});
```

The same goes for infinite queries (`persist: { page, pageParam }`) and
offline mutations (`persist: { variables }`).

A Standard Schema validates, but cannot encode, so the two kinds differ:

|                                       | Effect Schema         | Standard Schema (zod, …)                  |
| ------------------------------------- | --------------------- | ----------------------------------------- |
| stored as                             | its JSON encoding     | the data as is                            |
| restored by                           | decoding              | validating                                |
| `Date`, `DateTime`, `Option`, classes | round-trip            | do not survive: keep data JSON-compatible |
| when restoring fails                  | dropped and refetched | dropped and refetched                     |

Two rules for Standard Schema validators:

- **Synchronous only.** Restoring happens synchronously when a query is first
  used. A validator with async refinements cannot run there: its data is not
  restored, and a warning is logged once.
- **It must accept its own output.** The stored value is the validated
  output, which is validated again on restore. A transform that changes the
  type (`z.string().transform(Number)`) rejects its own output, so the data
  is dropped each time.

If a value is both (an Effect Schema with a `~standard` property), the Effect
Schema codec is used.

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
