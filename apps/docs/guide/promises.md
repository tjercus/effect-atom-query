# Promise boundaries

The library is Effect all the way through: queries, mutations, the
`QueryClient` API and the hooks take and return Effects. There is no
`mutateAsync`, and no `fetchQuery` returns a Promise.

Some code around a React app expects a Promise anyway: form libraries whose
submit handler is awaited, route loaders, and third-party callbacks. For
those edges there is one helper, `useRunEffect`, and for code outside React
there is the runtime you already have.

## In components: `useRunEffect`

`useRunEffect()` returns a runner bound to the nearest `QueryClientProvider`.
It runs an Effect with the services of the client's layer, plus the
`QueryClient` itself, and hands back a Promise:

```tsx
import { useMutation, useRunEffect } from "@effect-atom-query/react";

function EditPost({ post }: { readonly post: Post }) {
  const run = useRunEffect();
  const save = useMutation(savePost);
  const form = useForm({
    defaultValues: post,
    onSubmit: async ({ value }) => {
      const exit = await run.promiseExit(save.mutateEffect(value));
      Exit.match(exit, {
        onSuccess: (saved) => navigate(`/posts/${saved.id}`),
        onFailure: (cause) => setFormError(Cause.pretty(cause)),
      });
    },
  });
  return <SubmitButton busy={save.isPending} />;
}
```

| method                                | resolves with                                              | rejects                                     |
| ------------------------------------- | ---------------------------------------------------------- | ------------------------------------------- |
| `run.promiseExit(effect, { signal })` | the `Exit`: success, typed failure, defect or interruption | never                                       |
| `run.promise(effect, { signal })`     | the value                                                  | with the typed error itself (or the defect) |

- `promiseExit` is the one to use for forms: the outcome is a value you can
  check, as with RTK Query's `unwrap()` in a `try` / `catch`, without a
  rejection to forget.
- Running `mutateEffect` through the runner updates the hook's state like
  `mutate` does, so `save.isPending` and `save.error` keep working.
- `signal` interrupts the Effect when the `AbortSignal` aborts. An already
  aborted signal interrupts without running anything.
- The runner is stable for the client's lifetime, so it can be passed to code
  outside React, such as a third-party widget's callback.

A conditional works, because each method infers the whole Effect:

```ts
const exit = await run.promiseExit(
  mode === "edit" ? update.mutateEffect(values) : create.mutateEffect(values),
);
// Exit<Post | Draft, UpdateError | CreateError>
```

### Declaring your services

By default the runner accepts Effects that need only `QueryClient`. Declare
the services your runtime provides once, anywhere in the app:

```ts
// runtime.ts
declare module "@effect-atom-query/react" {
  interface Register {
    readonly services: ApiClient | Navigation;
  }
}
```

Every `useRunEffect()` then accepts Effects that need those services, and
rejects, at compile time, Effects that need anything else. The declaration is
a promise you make: if it lists a service the layer does not provide, the
Effect fails at run time with a missing-service defect. To type a single call
site instead, pass the services as a type argument: `useRunEffect<ApiClient>()`.

## Outside React: the runtime

Code that runs before React renders, or without a component, uses **the
runtime you passed to `QueryClientProvider`**. It holds the `QueryClient`
with its cache, and the services your queries and mutations need. Building
a second runtime from `QueryClient.layer()` gives you a second, empty cache.

Export it from one module, so the provider and these call sites share it:

```ts
// runtime.ts
export const runtime = ManagedRuntime.make(QueryClient.layer().pipe(Layer.provideMerge(AppLayer)));
```

`runtime.runPromise(effect)` resolves with the value, and rejects with the
typed error itself. `runtime.runPromiseExit(effect)` resolves with the
`Exit`. Both accept `{ signal }`.

Unlike `useRunEffect`, these take the success and error types as separate
parameters, so a union of two Effects (`cond ? a : b`) does not type-check:
run each branch on its own.

### Route loaders

Load data before a route renders with `client.ensureQueryData`. It returns
cached data when there is some, and fetches otherwise. The component then
reads the same query from the warm cache:

```ts
// TanStack Router
export const Route = createFileRoute("/todos/$id")({
  loader: ({ params, abortController }) =>
    runtime.runPromise(
      Effect.flatMap(QueryClient.QueryClient, (client) =>
        client.ensureQueryData(todoQuery(params.id)),
      ),
      { signal: abortController.signal },
    ),
  component: TodoPage,
});

function TodoPage() {
  const { id } = Route.useParams();
  const todo = useSuspenseQuery(todoQuery(id)); // renders at once from the cache
  // ...
}
```

Use `client.fetchQuery` to fetch unless the cached data is fresh, or
`client.prefetchQuery` to warm the cache without failing the loader: it
never fails and returns nothing, and the component shows the error instead.

### Plain modules and callbacks

Without a component, run the mutation through the client:

```ts
const onDrop = (files: ReadonlyArray<File>) =>
  runtime.runPromise(
    Effect.flatMap(QueryClient.QueryClient, (client) => client.mutate(uploadFiles, files)),
  );
```

## Inside an Effect

None of this is needed: `yield*` the Effect.

## Why not `mutateAsync`?

Keeping Promises out of the library keeps typed errors, interruption and
services intact everywhere inside it. A Promise rejection is untyped, and a
Promise cannot be cancelled. `useRunEffect` and the runtime are where an
Effect turns into a Promise, so that happens in one visible place, at the
edge of your app.
