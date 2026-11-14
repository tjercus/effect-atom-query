# @effect-atom-query/query

The framework-agnostic core of [effect-atom-query](https://github.com/tjercus/effect-atom-query):
server-state caching in the style of TanStack Query, written in Effect and
built on Effect Atoms.

It holds query and mutation definitions (`Query`, `InfiniteQuery`,
`Mutation`), the `QueryClient` service, observers, `QueryPersister`, the
focus and online managers, and `QueryInspector`.

```sh
pnpm add @effect-atom-query/query effect
```

```ts
import { Query, QueryClient } from "@effect-atom-query/query";
import { Effect } from "effect";

const todoQuery = Query.make({
  key: (id: number) => ["todos", id],
  run: (id) => TodoRepo.use((repo) => repo.get(id)),
});

const program = Effect.gen(function* () {
  const client = yield* QueryClient.QueryClient;
  return yield* client.fetchQuery(todoQuery(1));
}).pipe(Effect.provide(QueryClient.layer()));
```

Using React? Install
[`@effect-atom-query/react`](https://www.npmjs.com/package/@effect-atom-query/react)
instead, which re-exports this package. See the
[main README](https://github.com/tjercus/effect-atom-query#readme) for the full
introduction.

MIT © tjercus
