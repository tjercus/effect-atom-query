# @effect-atom-query/react

React bindings for [effect-atom-query](https://github.com/tjercus/effect-atom-query):
TanStack Query-style hooks on top of Effect and Effect Atoms. This package
re-exports the core (`@effect-atom-query/query`).

```sh
pnpm add @effect-atom-query/react effect @effect/atom-react react
```

```tsx
import { Query, QueryClient, QueryClientProvider, QueryResult, useQuery } from "@effect-atom-query/react"
import { Layer, ManagedRuntime } from "effect"

const todosQuery = Query.single({ key: ["todos"], run: TodoRepo.use((repo) => repo.list) })

function Todos() {
  const todos = useQuery(todosQuery)
  return QueryResult.match(todos, {
    onPending: () => <p>Loading…</p>,
    onFailure: () => <p>Failed</p>,
    onSuccess: (success) => <ul>{success.data.value.map((t) => <li key={t.id}>{t.title}</li>)}</ul>,
  })
}

const runtime = ManagedRuntime.make(QueryClient.layer().pipe(Layer.provideMerge(TodoRepoLive)))

<QueryClientProvider runtime={runtime}>
  <Todos />
</QueryClientProvider>
```

Hooks: `useQuery`, `useSuspenseQuery`, `useQueries`, `useSuspenseQueries`,
`useInfiniteQuery`, `useSuspenseInfiniteQuery`, `usePrefetchQuery`,
`useMutation`, `useMutationState`, `useIsFetching`, `useIsMutating`,
`useIsRestoring`, `useQueryClient`, `useQueryClientOption`, `useRunEffect` (the Promise boundary for
form libraries and callbacks), and `QueryErrorResetBoundary`.

Test utilities live in a separate entry point that does not depend on a test
runner: `makeTestHarness`, `controlled`, `queryHookResult`,
`mutationHookResult` and `testQueryClientLayer` from
`@effect-atom-query/react/testing`.

See the [documentation](https://tjercus.github.io/effect-atom-query/) and the
[main README](https://github.com/tjercus/effect-atom-query#readme).

MIT © tjercus
