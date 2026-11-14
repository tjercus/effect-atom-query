# Suspense & error boundaries

## Suspense

```tsx
function Todo({ id }: { id: string }) {
  const todo = useSuspenseQuery(todoQuery(id));
  return <h1>{todo.data.value.title}</h1>; // data is always Some
}

<Suspense fallback={<Spinner />}>
  <Todo id="1" />
</Suspense>;
```

- `useSuspenseQuery`, `useSuspenseQueries` (parallel, no waterfall) and
  `useSuspenseInfiniteQuery` suspend until data exists.
- Errors without data are thrown to the nearest error boundary. Refetch errors
  (data already present) are returned, not thrown.
- A query fetched under 1 second ago counts as fresh, so the remount after
  suspending does not refetch (TanStack's Suspense `staleTime` floor).
- While a [persister](./persistence) restores in the background, suspense hooks
  wait for it.

## Avoiding waterfalls

`usePrefetchQuery(query)` starts a fetch during render without suspending. A
child that suspends on the same query later joins the fetch already in flight:

```tsx
function Page({ id }: { id: string }) {
  usePrefetchQuery(commentsQuery(id)); // starts now
  return (
    <Suspense fallback="…">
      <Article id={id} /> {/* suspends on articleQuery */}
      <Comments id={id} /> {/* commentsQuery is already loading */}
    </Suspense>
  );
}
```

## Resetting error boundaries

After an error is thrown to a boundary, a remount must not immediately
re-throw the cached error, and it must not retry in a loop either.
`QueryErrorResetBoundary` uses the same protocol as TanStack's:

```tsx
<QueryErrorResetBoundary>
  {({ reset }) => (
    <ErrorBoundary
      onReset={reset}
      fallbackRender={({ resetErrorBoundary }) => (
        <button onClick={resetErrorBoundary}>Try again</button>
      )}
    >
      <Suspense fallback="…">
        <Todo id="1" />
      </Suspense>
    </ErrorBoundary>
  )}
</QueryErrorResetBoundary>
```

Until `reset()` is called, errored queries under the boundary do not refetch on
mount. After it, they do.

## Throwing from useQuery

`useQuery(query, { throwOnError: true })` (or a predicate on the typed error)
throws to the nearest boundary once no fetch is running. Defects are always
thrown.
