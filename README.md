# effect-atom-query

Server-state caching for React in the style of [TanStack Query](https://tanstack.com/query),
written as idiomatic [Effect](https://effect.website) and built on Effect Atoms.

📖 **[Documentation](https://tjercus.github.io/effect-atom-query/)**

- **Queries are Effects.** `run` returns an `Effect<A, E, R>`, so errors stay
  typed all the way to the component and services come from your runtime.
  Retries are `Schedule`s, and cancellation is fiber interruption.
- **Queries are atoms.** Define a query once at module level, then read it with
  `useQuery`, with `useAtomValue`, or with any `Atom` combinator. Outside React
  it's an `Effect` call.
- **No `undefined`.** `data` and `error` are `Option`s, and a result is a tagged
  union (`Pending | Success | Failure`) that narrows on `isSuccess`.
- **TanStack's model.** The same defaults (`staleTime`, `gcTime`, retries with
  backoff), the same triggers (mount, window focus, reconnect, polling), request
  deduplication, structural sharing, query filters and hooks.

> **Status:** pre-release (0.x), not yet published to npm. The API may still
> change.

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Features](#features)
- [Coming from TanStack Query](#coming-from-tanstack-query)
- [Coming from Redux / RTK Query](#coming-from-redux--rtk-query)
- [Packages](#packages)
- [Documentation](#documentation)
- [Development](#development)
- [License](#license)

## Install

```sh
pnpm add @effect-atom-query/react effect @effect/atom-react react
pnpm add -D @effect-atom-query/devtools   # optional
```

Requires `effect` 4.1+, `@effect/atom-react` 4.1+ and React 19. The library is
developed and type-checked with TypeScript 7.

Installing through a company npm proxy that returns `404 Not Found`? See
[Behind a company npm proxy](https://tjercus.github.io/effect-atom-query/guide/getting-started#behind-a-company-npm-proxy).

`@effect-atom-query/react` re-exports the framework-agnostic core
(`@effect-atom-query/query`), so React apps import everything from one package.

## Quick start

```tsx
import { Context, Effect, Layer, ManagedRuntime, Option } from "effect";
import {
  Mutation,
  Query,
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@effect-atom-query/react";
import { QueryDevtools } from "@effect-atom-query/devtools";
import { createRoot } from "react-dom/client";
import { Todo, TodoError, TodoRepoLive } from "./todos"; // your domain types and implementation

// Your services, as usual in Effect
class TodoRepo extends Context.Service<
  TodoRepo,
  {
    readonly list: Effect.Effect<ReadonlyArray<Todo>, TodoError>;
    readonly get: (id: number) => Effect.Effect<Todo, TodoError>;
    readonly add: (title: string) => Effect.Effect<Todo, TodoError>;
  }
>()("app/TodoRepo") {}

// 1. Queries are defined once, at module level
const todosQuery = Query.single({
  key: ["todos"],
  run: TodoRepo.use((repo) => repo.list),
});

const todoQuery = Query.make({
  key: (id: number) => ["todos", id],
  run: (id) => TodoRepo.use((repo) => repo.get(id)),
  staleTime: "30 seconds",
});

// 2. So are mutations. `invalidates` refetches matching queries after success
const addTodo = Mutation.make({
  key: ["todos", "add"],
  run: (title: string) => TodoRepo.use((repo) => repo.add(title)),
  invalidates: [["todos"]],
});

// 3. Components
function TodoList() {
  const todos = useQuery(todosQuery);
  const add = useMutation(addTodo);

  if (todos.isPending) return <p>Loading…</p>;
  if (todos.isError) {
    return (
      <p>
        Failed: {Option.match(todos.error, { onNone: () => "defect", onSome: (e) => e.message })}
      </p>
    );
  }
  return (
    <>
      <ul>
        {todos.data.value.map((todo) => (
          <li key={todo.id}>{todo.title}</li>
        ))}
      </ul>
      <button disabled={add.isPending} onClick={() => add.mutate("Buy milk")}>
        Add
      </button>
    </>
  );
}

function TodoTitle({ id }: { id: number }) {
  const todo = useQuery(todoQuery(id), { select: (t) => t.title });
  return <h1>{todo.isSuccess ? todo.data.value : "…"}</h1>;
}

// 4. A runtime with the client and your services
const runtime = ManagedRuntime.make(QueryClient.layer().pipe(Layer.provideMerge(TodoRepoLive)));

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider runtime={runtime}>
    <TodoList />
    <TodoTitle id={1} />
    <QueryDevtools />
  </QueryClientProvider>,
);

// 5. Outside React, everything is an Effect
const program = Effect.gen(function* () {
  const client = yield* QueryClient.QueryClient;
  const todo = yield* client.fetchQuery(todoQuery(1)); // Effect<Todo, TodoError, TodoRepo>
  yield* client.invalidateQueries({ queryKey: ["todos"] });
  return todo;
});
```

## Features

| Area             | What you get                                                                                                                                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Queries          | `Query.make` (families) / `Query.single`, structural keys with prefix filters, `staleTime`, `gcTime`, retries as `Schedule`, `enabled` / `Query.skipToken`, `initialData`, `select`, `placeholderData` / `Query.keepPreviousData`, structural sharing |
| Triggers         | refetch on mount, window focus and reconnect, polling, `networkMode` (`online` / `always` / `offlineFirst`)                                                                                                                                           |
| React            | `useQuery`, `useQueries`, `useInfiniteQuery`, `useMutation`, `useMutationState`, `useIsFetching`, `useIsMutating`, `usePrefetchQuery`. Components re-render only for the result properties they read                                                  |
| Suspense         | `useSuspenseQuery`, `useSuspenseQueries`, `useSuspenseInfiniteQuery`, `QueryErrorResetBoundary`                                                                                                                                                       |
| Mutations        | Effect callbacks (`onMutate`, `onError`, `onSettled`) for optimistic updates with rollback, `Mutation.optimistic` overlays, `invalidates`, serial `scope`s, `reactivityKeys` for Effect's `Reactivity`                                                |
| Infinite queries | bidirectional pages, sequential refetch of all pages, `maxPages`                                                                                                                                                                                      |
| Persistence      | `QueryPersister` with any `KeyValueStore`; per-query opt-in with a `Schema`, so restored data is decoded back into real types (`DateTime`, `Option`, classes)                                                                                         |
| Offline          | paused mutations that persist and resume after a reload                                                                                                                                                                                               |
| Client           | `fetchQuery`, `prefetchQuery`, `setQueryData`, `invalidateQueries`, `cancelQueries`, …, all returning `Effect`                                                                                                                                        |
| Devtools         | in-app panel with query and mutation inspector and actions; stripped from production builds                                                                                                                                                           |

Not yet supported: SSR (`dehydrate` / `hydrate`, `HydrationBoundary`).

## Coming from TanStack Query

| TanStack Query                                 | effect-atom-query                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| `useQuery({ queryKey, queryFn })`              | `useQuery(todoQuery(id))`, with the query defined once via `Query.make` |
| `queryFn: () => Promise<T>`                    | `run: Effect<A, E, R>`                                                  |
| `data: T \| undefined`, `error: E \| null`     | `data: Option<A>`, `error: Option<E>`, plus the full `cause`            |
| `enabled: !!id`                                | `todoQuery(id ?? Query.skipToken)`                                      |
| `retry: 3`, `retryDelay`                       | `retry: 3`, or any `Schedule`                                           |
| `AbortSignal`                                  | fiber interruption                                                      |
| `queryClient.fetchQuery()` returns a `Promise` | `client.fetchQuery()` returns an `Effect`                               |
| `new QueryClient()`                            | `QueryClient.layer()` in a `ManagedRuntime`                             |
| `onSettled: () => invalidateQueries(...)`      | `invalidates: [["todos"]]`                                              |
| `persistQueryClient`                           | `QueryPersister.layer` + per-query `persist: { schema }`                |

More in the [migration guide](https://tjercus.github.io/effect-atom-query/guide/from-tanstack).

## Coming from Redux / RTK Query

| Redux Toolkit / RTK Query                  | effect-atom-query                                                  |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `createApi` + `fetchBaseQuery`             | an API service in a `Layer` (e.g. on `HttpClient`)                 |
| `builder.query` / `builder.mutation`       | `Query.make` / `Mutation.make`, defined at module level            |
| `providesTags` / `invalidatesTags`         | query keys / `invalidates`, matched by key prefix                  |
| `useGetPostQuery(id ?? skipToken)`         | `useQuery(postQuery(id ?? Query.skipToken))`                       |
| `await trigger(x).unwrap()`                | `mutate(x, { onSuccess, onError })`, or `mutateEffect` + a runtime |
| `createSlice` + `useSelector` / `dispatch` | `Atom.make` + `useAtomValue` / `useAtomSet`                        |
| `redux-persist`                            | `Atom.kvs` for client state, `QueryPersister` for the query cache  |

Defaults follow TanStack Query, not RTK Query: data goes stale at once, and
refetching on focus and reconnect is on. More in the
[Redux / RTK Query guide](https://tjercus.github.io/effect-atom-query/guide/from-redux).

## Packages

| Package                                                                                                   | Contents                                                       | Size (min+gzip)              |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------- |
| [`@effect-atom-query/query`](https://github.com/tjercus/effect-atom-query/tree/main/packages/query)       | framework-agnostic core: queries, mutations, client, persister | 14.3 kB                      |
| [`@effect-atom-query/react`](https://github.com/tjercus/effect-atom-query/tree/main/packages/react)       | provider and hooks; re-exports the core                        | 16.4 kB including the core   |
| [`@effect-atom-query/devtools`](https://github.com/tjercus/effect-atom-query/tree/main/packages/devtools) | devtools panel                                                 | 0.15 kB in production builds |

Sizes exclude the peer dependencies (`effect`, `react`, `@effect/atom-react`).
A typical app (provider + `useQuery`) adds 12.3 kB. CI enforces these budgets
(`size-budget.json`).

## Documentation

**Documentation site: <https://tjercus.github.io/effect-atom-query/>**. Its source is in [`apps/docs`](https://github.com/tjercus/effect-atom-query/tree/main/apps/docs)
(VitePress; run it locally with `vp run docs#dev`).

- [Getting started](https://tjercus.github.io/effect-atom-query/guide/getting-started)
- [Queries](https://tjercus.github.io/effect-atom-query/guide/queries) · [React hooks](https://tjercus.github.io/effect-atom-query/guide/react) · [Mutations](https://tjercus.github.io/effect-atom-query/guide/mutations)
- [Infinite queries](https://tjercus.github.io/effect-atom-query/guide/infinite-queries) · [Suspense & error boundaries](https://tjercus.github.io/effect-atom-query/guide/suspense)
- [The QueryClient](https://tjercus.github.io/effect-atom-query/guide/query-client) · [Persistence & offline](https://tjercus.github.io/effect-atom-query/guide/persistence)
- [Devtools](https://tjercus.github.io/effect-atom-query/guide/devtools) · [Testing](https://tjercus.github.io/effect-atom-query/guide/testing)

**Examples:** [`apps/playground`](https://github.com/tjercus/effect-atom-query/tree/main/apps/playground) has 12 runnable examples that
mirror TanStack Query's React examples (pagination, infinite scroll, optimistic
updates, Suspense, offline, …). They run against a fake backend service. Start
them with `vp run dev`. See the [examples index](https://tjercus.github.io/effect-atom-query/examples).

Design notes: [plan](https://github.com/tjercus/effect-atom-query/blob/main/docs/PLAN.md), [TanStack feature matrix](https://github.com/tjercus/effect-atom-query/blob/main/docs/FEATURE-MATRIX.md),
[decisions](https://github.com/tjercus/effect-atom-query/blob/main/docs/QUESTIONS.md).

## Development

This is a [Vite+](https://viteplus.dev) monorepo (pnpm workspaces, TypeScript 7).

```sh
vp install            # install dependencies
vp check              # format, lint, type check
vp run -r test        # tests (Vitest, @effect/vitest, Testing Library)
vp run dev            # playground with examples and devtools
vp run docs#dev       # documentation site
pnpm run ready        # everything CI runs: check, tests, builds, size budget
```

Releases use Changesets; see [docs/RELEASING.md](https://github.com/tjercus/effect-atom-query/blob/main/docs/RELEASING.md).

## License

[MIT](https://github.com/tjercus/effect-atom-query/blob/main/LICENSE) © tjercus
