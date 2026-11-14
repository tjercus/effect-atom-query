# @effect-atom-query/react

React bindings for [effect-atom-query](https://github.com/tjercus/effect-atom-query):
TanStack Query-style hooks on top of Effect and Effect Atoms. This package
re-exports the core (`@effect-atom-query/query`).

```sh
pnpm add @effect-atom-query/react effect @effect/atom-react react
```

```tsx
import { Query, QueryClient, QueryClientProvider, useQuery } from "@effect-atom-query/react"
import { Layer, ManagedRuntime } from "effect"

const todosQuery = Query.single({ key: ["todos"], run: TodoRepo.use((repo) => repo.list) })

function Todos() {
  const todos = useQuery(todosQuery)
  if (!todos.isSuccess) return <p>Loading…</p>
  return <ul>{todos.data.value.map((t) => <li key={t.id}>{t.title}</li>)}</ul>
}

const runtime = ManagedRuntime.make(QueryClient.layer().pipe(Layer.provideMerge(TodoRepoLive)))

<QueryClientProvider runtime={runtime}>
  <Todos />
</QueryClientProvider>
```

Hooks: `useQuery`, `useSuspenseQuery`, `useQueries`, `useSuspenseQueries`,
`useInfiniteQuery`, `useSuspenseInfiniteQuery`, `usePrefetchQuery`,
`useMutation`, `useMutationState`, `useIsFetching`, `useIsMutating`,
`useIsRestoring`, `useQueryClient`, and `QueryErrorResetBoundary`.

See the [main README](https://github.com/tjercus/effect-atom-query#readme) and
the guide in [`apps/docs`](https://github.com/tjercus/effect-atom-query/tree/main/apps/docs).

MIT © tjercus
