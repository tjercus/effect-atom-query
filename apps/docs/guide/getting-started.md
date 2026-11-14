# Getting started

effect-atom-query is a server-state cache for React modelled on
[TanStack Query](https://tanstack.com/query), written in idiomatic
[Effect](https://effect.website). Queries are Effects, the cache lives in an
Effect service, and every query is an Effect Atom.

## Install

```sh
pnpm add @effect-atom-query/react @effect-atom-query/query effect @effect/atom-react react
# optional
pnpm add -D @effect-atom-query/devtools
```

`@effect-atom-query/react` re-exports everything from the framework-agnostic
`@effect-atom-query/query` package, so React apps import from one place.

### Behind a company npm proxy

If your company installs packages through a proxy registry (Sonatype Nexus,
Artifactory, …) that does not serve the `@effect-atom-query` scope yet, the
install fails with `404 Not Found`. Until the proxy is set up, fetch this scope
from the public registry. Add to the project's `.npmrc`:

```ini
@effect-atom-query:registry=https://registry.npmjs.org/
replace-registry-host=never
```

The second line is for npm: without it, npm rewrites the tarball URLs back to
the proxy and fails with `EALLOWREMOTE`. It applies to every package in the
project, not only this scope: npm then also leaves other lockfile entries that
point at `registry.npmjs.org` as they are, instead of fetching them through
the proxy, and npm 12 refuses those with `EALLOWREMOTE` too. If that happens,
regenerate those entries through the proxy, or use the one-off command below
instead of the `.npmrc` lines. Remove the setting once the proxy serves the
scope.

As a one-off command:

```sh
npm install @effect-atom-query/react @effect-atom-query/query --@effect-atom-query:registry=https://registry.npmjs.org/ --replace-registry-host=never
```

## Provide a client

A `QueryClient` is an Effect service built by a `Layer`. Build it into a
`ManagedRuntime` together with the services your queries need, and hand the
runtime to the provider:

```tsx
import { QueryClient, QueryClientProvider } from "@effect-atom-query/react";
import { QueryDevtools } from "@effect-atom-query/devtools";
import { Layer, ManagedRuntime } from "effect";
import { TodoRepo } from "./TodoRepo";

const runtime = ManagedRuntime.make(QueryClient.layer().pipe(Layer.provideMerge(TodoRepo.layer)));

createRoot(root).render(
  <QueryClientProvider runtime={runtime}>
    <App />
    <QueryDevtools />
  </QueryClientProvider>,
);
```

Queries started by components run with the services of the client's layer
(here `TodoRepo`).

## Define a query

```ts
import { Query } from "@effect-atom-query/react";

export const todosQuery = Query.single({
  key: ["todos"],
  run: TodoRepo.use((repo) => repo.list),
});

export const todoQuery = Query.make({
  key: (id: string) => ["todos", id],
  run: (id) => TodoRepo.use((repo) => repo.get(id)),
  staleTime: "30 seconds",
});
```

`Query.make` is a family: `todoQuery("1")` returns the same atom every time it
is called with an equal argument.

## Use it

```tsx
import { useQuery } from "@effect-atom-query/react";

function Todo({ id }: { id: string }) {
  const todo = useQuery(todoQuery(id));
  if (todo.isPending) return <p>Loading…</p>;
  if (todo.isError) return <p>Failed</p>;
  return <h1>{todo.data.value.title}</h1>;
}
```

After narrowing on `isSuccess` / `isPending` / `isError`, `data` is an
`Option.Some` (or `Option.None`), so `data.value` is typed without `!` or `?.`.

## Next

- [Queries](./queries): keys, options and results.
- [React hooks](./react): every hook and its options.
- [Coming from TanStack Query](./from-tanstack): what is the same and what changed.
