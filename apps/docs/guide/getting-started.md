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

::: tip `Service.use` and the hooks lint rule
`eslint-plugin-react-hooks` treats `TodoRepo.use(...)` as a React hook (a
PascalCase object with a method named `use`), so `rules-of-hooks` reports it
outside components. If your project uses that rule, write
`Effect.flatMap(TodoRepo, (repo) => repo.list)` or `Effect.gen` instead.
:::

## Use it

```tsx
import { QueryResult, useQuery } from "@effect-atom-query/react";
import { Option } from "effect";

function Todos() {
  const todos = useQuery(todosQuery);
  return QueryResult.match(todos, {
    onPending: () => <p>Loading…</p>,
    onFailure: (failure) => (
      <p role="alert">
        {Option.match(failure.error, {
          onNone: () => "Something went wrong",
          onSome: (error) => error.message, // the typed TodoError
        })}{" "}
        <button onClick={todos.refetch}>Retry</button>
      </p>
    ),
    onSuccess: (success) =>
      success.data.value.length === 0 ? (
        <p>Nothing to do.</p>
      ) : (
        <ul>
          {success.data.value.map((todo) => (
            <li key={todo.id}>{todo.title}</li>
          ))}
        </ul>
      ),
  });
}
```

`QueryResult.match` hands each case the narrowed result. In `onSuccess`, `data`
is an `Option.Some`, so `data.value` is typed without `!` or `?.`. Narrowing on
`isSuccess` / `isPending` / `isError` works too.

What each case means:

- **Loading.** `onPending` runs until the first data or error arrives. A
  failed attempt is retried first (3 times with backoff by default), so a
  flaky request shows `Loading…` a little longer instead of an error;
  `failureCount` tells you a retry is running.
- **Typed failure.** `failure.error` is the `E` of `run`, here `TodoError`.
  It is `None` only for a defect, which the React bindings send to the
  nearest error boundary instead.
- **Failure with old data.** When a refetch fails after an earlier success,
  `failure.data` still holds that data (`isRefetchError`). The example above
  replaces the list with the error to stay short; in an app, show the old
  data with the error, as the
  [playground examples](https://github.com/tjercus/effect-atom-query/tree/main/apps/playground/src/examples)
  do.
- **Empty result.** An empty list is a success like any other: check the data.
- **Retry.** `refetch()` starts a new fetch from a button. To wait for it,
  see [Waiting for a refetch](./react#waiting-for-a-refetch).

## Share the registry with other code

`QueryClientProvider` creates its own atom registry. When code outside React
reads or writes atoms too (an auth store, a router), create the registry once
and pass it in, so components, that code and the query atoms share it. See
[One app-wide registry](./react#one-app-wide-registry).

## Test it

`@effect-atom-query/react/testing` renders components with your fake
services and a test client (no retries, no refetch on focus):

```tsx
import { makeTestHarness } from "@effect-atom-query/react/testing";

it("lists todos", async () => {
  const harness = makeTestHarness({ layer: FakeTodoRepo });
  render(<Todos />, { wrapper: harness.Wrapper });
  expect(await screen.findByText("learn Effect")).toBeTruthy();
  await harness.dispose();
});
```

See [Testing](./testing) for loading states, controlled requests and mocking
hooks, and the
[playground tests](https://github.com/tjercus/effect-atom-query/tree/main/apps/playground/test)
for a whole app tested this way, failures included.

## Next

- [Queries](./queries): keys, options and results.
- [Testing](./testing): the harness, controlled requests and hook mocks.
- [React hooks](./react): every hook and its options.
- [Coming from TanStack Query](./from-tanstack): what is the same and what changed.
