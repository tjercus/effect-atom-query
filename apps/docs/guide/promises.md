# Promise boundaries

The client's API returns Effects on purpose: no `fetchQuery` returns a
Promise, and there is no `mutateAsync`. Some APIs around a React app expect a
Promise anyway: route loaders, form libraries whose submit handler is
awaited, and third-party callbacks. At those boundaries, run the Effect on a
runtime and hand back the Promise.

## Which runtime

Use **the runtime you passed to `QueryClientProvider`**. It holds the
`QueryClient` with its cache, and the services your queries and mutations need.
Building a second runtime from `QueryClient.layer()` gives you a second,
empty cache.

Export it from one module, so the provider and the boundaries share it:

```ts
// runtime.ts
export const runtime = ManagedRuntime.make(QueryClient.layer().pipe(Layer.provideMerge(AppLayer)));
```

`runtime.runPromise(effect)` resolves with the value, and rejects with the
typed error itself (for example a `NotFound` instance). Use
`runtime.runPromiseExit(effect)` to get an `Exit` instead of a rejection.
Both accept `{ signal }` to interrupt the Effect when an `AbortSignal` fires.

## Route loaders

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

## Form submit handlers

In a component, `mutateEffect` runs the mutation through `useMutation`, so
`isPending`, `error` and the other flags keep working. Turn it into a Promise
for the form library:

```tsx
function EditTodo({ todo }: { readonly todo: Todo }) {
  const save = useMutation(saveTodo);
  const form = useForm({
    defaultValues: todo,
    onSubmit: ({ value }) => runtime.runPromise(save.mutateEffect(value)),
  });
  // ...
}
```

To show a typed failure in the form instead of rejecting, use
`runPromiseExit`:

```ts
onSubmit: async ({ value }) => {
  const exit = await runtime.runPromiseExit(save.mutateEffect(value));
  if (Exit.isFailure(exit)) setFormError(Cause.pretty(exit.cause));
},
```

## Outside components

Without a component (third-party callbacks, plain modules), run the mutation
through the client:

```ts
const onDrop = (files: ReadonlyArray<File>) =>
  runtime.runPromise(
    Effect.flatMap(QueryClient.QueryClient, (client) => client.mutate(uploadFiles, files)),
  );
```

Inside an Effect, none of this is needed: `yield*` the Effect.
