# Coming from Redux / RTK Query

A Redux Toolkit app usually holds two kinds of state in one store:

- **Server state**, cached by RTK Query (`createApi`, generated hooks, tags).
  This becomes queries and mutations.
- **Client state**, in slices (`createSlice`, `useSelector`, `dispatch`), often
  persisted to `localStorage`. This becomes plain Effect Atoms.

Both live in one `AtomRegistry`, so there is still one place that holds the
app's state. There is no store, no actions and no reducers: queries are
module-level definitions, and client state is atoms changed by pure functions.

This guide follows the order that works best for a real migration: the base
query, endpoints, components, client state, then tests. A
[pitfalls checklist](#pitfalls-checklist) at the end lists the behaviour
differences that turned into bugs in a real port.

## Concept map

### RTK Query

| RTK Query                                          | effect-atom-query                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `createApi({ baseQuery, endpoints })`              | a service (`ApiClient`) in a `Layer`, plus module-level definitions                          |
| `fetchBaseQuery({ baseUrl, prepareHeaders })`      | `HttpClient` from `effect/http` with `mapRequest` / `mapRequestEffect`                       |
| `builder.query`                                    | `Query.make` (with an argument) or `Query.single` (without)                                  |
| `builder.mutation`                                 | `Mutation.make`                                                                              |
| `builder.infiniteQuery`                            | `InfiniteQuery.make` + `useInfiniteQuery`                                                    |
| `providesTags`                                     | the query's `key`                                                                            |
| `invalidatesTags`                                  | the mutation's `invalidates` (keys, matched by prefix)                                       |
| `api.util.invalidateTags([...])`                   | `client.invalidateQueries({ queryKey })`                                                     |
| `useGetPostQuery(id)` (generated)                  | `useQuery(postQuery(id))`, or your own `usePostQuery` wrapper                                |
| `useGetPostQuery(id ?? skipToken)`, `skip: true`   | `useQuery(postQuery(id ?? Query.skipToken))`, or `enabled: false`                            |
| `selectFromResult`                                 | `select`                                                                                     |
| `transformResponse`                                | inside `run`: parse or `Effect.map`                                                          |
| `transformErrorResponse`                           | inside `run`: `Effect.mapError`                                                              |
| `keepUnusedDataFor: 60` (seconds)                  | `gcTime` (default `"5 minutes"`)                                                             |
| `refetchOnMountOrArgChange`                        | `staleTime` and `refetchOnMount`                                                             |
| `pollingInterval`                                  | `refetchInterval`                                                                            |
| `refetchOnFocus` / `refetchOnReconnect`            | `refetchOnWindowFocus` / `refetchOnReconnect`, **on by default**                             |
| `const [trigger, state] = useUpdatePostMutation()` | `const update = useMutation(updatePost)`                                                     |
| `await trigger(x).unwrap()`                        | `mutate(x, { onSuccess, onError })`, or `useRunEffect().promiseExit(update.mutateEffect(x))` |
| `onQueryStarted` + `updateQueryData` (optimistic)  | `Mutation.optimisticUpdate(query, update)`                                                   |
| `dispatch(api.util.prefetch(...))`                 | `usePrefetchQuery`, or `client.prefetchQuery` in an Effect                                   |
| `serializeQueryArgs` / `merge` / `forceRefetch`    | an infinite query, or nothing: structural sharing keeps unchanged data stable                |
| `data?: T`, `error?: FetchBaseQueryError`          | `data: Option<A>`, `error: Option<E>` with your own typed `E`                                |
| `isLoading`, `isFetching`, `isSuccess`, `isError`  | the same flags; `isSuccess` narrows `data` to `Some`                                         |

### Redux slices

| Redux Toolkit                                | Effect Atoms                                                                |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| `createSlice({ initialState, reducers })`    | `Atom.make(initialState)` plus pure `(state, input) => state` functions     |
| `useSelector(selectX)`                       | `useAtomValue(xAtom)`                                                       |
| `createSelector`                             | `Atom.map(xAtom, f)`, or an `Atom.make((get) => ...)` reading several atoms |
| `dispatch(action)`                           | `useAtomSet(xAtom)(f)`, or `registry.set(xAtom, value)` outside React       |
| `configureStore` + `<Provider store>`        | one `AtomRegistry`, passed to `QueryClientProvider`                         |
| `preloadedState` in tests                    | `registry.set(xAtom, fixture)` before rendering                             |
| `redux-persist`, `redux-localstorage-simple` | `Atom.kvs` for client state; `QueryPersister` for the query cache           |
| Redux DevTools                               | `@effect-atom-query/devtools` for queries; atoms have no time travel        |

## Defaults that differ

RTK Query and TanStack Query, whose defaults this library follows, disagree on
several defaults. Ported code that relied on RTK's defaults changes behaviour
unless you set these:

| behaviour                           | RTK Query                             | effect-atom-query                       |
| ----------------------------------- | ------------------------------------- | --------------------------------------- |
| data goes stale                     | never (cached until invalidated)      | immediately (`staleTime: 0`)            |
| refetch when a component mounts     | only with `refetchOnMountOrArgChange` | when stale                              |
| refetch on window focus / reconnect | off, and needs `setupListeners`       | on                                      |
| unused data kept for                | 60 seconds                            | 5 minutes (`gcTime`)                    |
| retries                             | none (`fetchBaseQuery`)               | 3, with exponential backoff             |
| mutation settles                    | when the request finishes             | after the invalidated queries refetched |

To keep RTK's behaviour app-wide, set client defaults once:

```ts
QueryClient.layer({
  defaultOptions: {
    queries: {
      staleTime: "Infinity", // cached until invalidated
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
      gcTime: "1 minute",
    },
  },
});
```

::: warning `"Infinity"`, not `"static"`
`staleTime: "static"` looks like RTK's "cached until invalidated", but static
queries are **skipped** by invalidation and refetches. Use `"Infinity"`: the
data never goes stale by time, and `invalidates` still refetches it.
:::

If your slices set `refetchOnFocus` / `refetchOnReconnect` but the app never
called `setupListeners`, those options were never active. Turning the defaults
off keeps that behaviour.

## Step 1: the base query becomes a service

The library does not ship an HTTP layer: `run` can be any Effect. Port
`fetchBaseQuery` + `prepareHeaders` to a small service on top of `HttpClient`
from `effect/http`. Every query and mutation gets it from the runtime, and
tests replace it with a `Layer`.

```ts
// api/ApiClient.ts
import { Context, Data, Effect, Layer } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

export class ApiError extends Data.TaggedError("ApiError")<{
  readonly status: number | "FETCH_ERROR" | "PARSING_ERROR";
  readonly message: string; // always set it: see "Empty error messages" below
}> {}

type Method = "GET" | "POST" | "PUT" | "DELETE";

export class ApiClient extends Context.Service<
  ApiClient,
  {
    readonly request: <A>(
      method: Method,
      path: string,
      options: { readonly body?: unknown; readonly parse: (json: unknown) => A },
    ) => Effect.Effect<A, ApiError>;
  }
>()("app/ApiClient") {}

export const ApiClientLive = Layer.effect(
  ApiClient,
  Effect.gen(function* () {
    const http = (yield* HttpClient.HttpClient).pipe(
      HttpClient.mapRequest(HttpClientRequest.prependUrl("/api")), // baseUrl
      HttpClient.mapRequestEffect((request) =>
        // prepareHeaders
        Effect.map(getAccessToken, (token) => HttpClientRequest.bearerToken(request, token)),
      ),
    );
    return ApiClient.of({
      request: (method, path, { body, parse }) =>
        Effect.gen(function* () {
          let request = HttpClientRequest.make(method)(path);
          if (body !== undefined) request = HttpClientRequest.bodyJsonUnsafe(request, body);
          const response = yield* http
            .execute(request)
            .pipe(
              Effect.mapError((e) => new ApiError({ status: "FETCH_ERROR", message: e.message })),
            );
          if (response.status >= 400) {
            return yield* new ApiError({
              status: response.status,
              message: `Request failed with status ${response.status}`,
            });
          }
          if (response.status === 204) return parse(null);
          const json = yield* response.json.pipe(
            Effect.mapError(
              () =>
                new ApiError({ status: "PARSING_ERROR", message: "Response could not be parsed" }),
            ),
          );
          return yield* Effect.try({
            try: () => parse(json),
            catch: () =>
              new ApiError({ status: "PARSING_ERROR", message: "Unexpected response shape" }),
          });
        }),
    });
  }),
).pipe(Layer.provide(FetchHttpClient.layer));
```

`parse` takes any validator, so an app that validates with zod keeps doing so
(`parse: PostSchema.parse`). Write a spec for this service: it replaces code
you used to get from RTK, and its edge cases (a successful response whose body
does not parse, a `204` with no body) are where the bugs hide.

Then build one runtime with the client and the service, and provide it:

```tsx
export const runtime = ManagedRuntime.make(
  QueryClient.layer().pipe(Layer.provideMerge(ApiClientLive)),
);

<QueryClientProvider runtime={runtime}>
  <App />
</QueryClientProvider>;
```

::: tip Base URL
RTK slices usually compute `baseUrl` when the module is imported. A layer
reads it when the runtime is built. Tests that replace `window` or
`window.location` may need adjusting.
:::

## Step 2: endpoints become definitions, tags become keys

RTK Query invalidates by **tag**: queries provide tags, mutations invalidate
them. Here a query's **key** plays both roles, and invalidation matches keys
by prefix, so `["posts"]` invalidates `["posts", "list"]` and
`["posts", "detail", 1]`.

```ts
// RTK Query
const postsApi = createApi({
  baseQuery,
  tagTypes: ["Post"],
  endpoints: (build) => ({
    getPosts: build.query<Post[], void>({
      query: () => "posts",
      providesTags: [{ type: "Post", id: "LIST" }],
    }),
    getPost: build.query<Post, number>({
      query: (id) => `posts/${id}`,
      providesTags: (_r, _e, id) => [{ type: "Post", id }],
    }),
    updatePost: build.mutation<Post, Post>({
      query: (post) => ({ url: `posts/${post.id}`, method: "PUT", body: post }),
      invalidatesTags: (_r, _e, post) => [
        { type: "Post", id: "LIST" },
        { type: "Post", id: post.id },
      ],
    }),
  }),
});
export const { useGetPostsQuery, useGetPostQuery, useUpdatePostMutation } = postsApi;
```

```ts
// effect-atom-query
export const postKeys = {
  all: ["posts"] as const,
  list: () => [...postKeys.all, "list"] as const,
  detail: (id: number) => [...postKeys.all, "detail", id] as const,
};

export const postsQuery = Query.single({
  key: postKeys.list(),
  run: Effect.flatMap(ApiClient, (api) => api.request("GET", "/posts", { parse: parsePosts })),
});

export const postQuery = Query.make({
  key: (id: number) => postKeys.detail(id),
  run: (id) =>
    Effect.flatMap(ApiClient, (api) => api.request("GET", `/posts/${id}`, { parse: parsePost })),
});

export const updatePost = Mutation.make({
  run: (post: Post) =>
    Effect.flatMap(ApiClient, (api) =>
      api.request("PUT", `/posts/${post.id}`, { body: post, parse: parsePost }),
    ),
  invalidates: (_data, post) => [postKeys.list(), postKeys.detail(post.id)],
});

// optional: named hooks, so components and test mocks keep their shape
export const usePostsQuery = () => useQuery(postsQuery);
export const usePostQuery = (id: number | undefined) => useQuery(postQuery(id ?? Query.skipToken));
```

Some notes on the port:

- **Keys need `as const`.** A key is a tuple whose first element is a string.
  A key constant built with spreads and no `as const` widens to `string[]`,
  and `Query.make` / `invalidates` then fail with a long "No overload matches
  this call" error.
- **Cross-API invalidation is just a key.** RTK needs the same `tagTypes`
  registered on both APIs. Here a mutation in `planetApi.ts` lists
  `spaceshipKeys.all` in `invalidates`. Use the function form
  (`invalidates: () => [...]`) for keys from other modules, so partial mocks of
  that module do not crash at import (see [Testing](./testing#mocking-hooks-from-another-module)).
- **`transformResponse` / `transformErrorResponse`** move into `run`:
  `Effect.map(...)` for the data, `Effect.mapError(...)` for the error. The
  query's error type follows, so consumers see the mapped type.
- **Queries without an argument** (`Query.single`) cannot take
  `Query.skipToken`. Disable them with `enabled: false` in the definition or
  as a hook option.
- **`selectFromResult`** becomes `select`, which runs per component:
  `useQuery(postsQuery, { select: (posts) => posts.length })`.
- **`serializeQueryArgs` + `merge` for "load more" lists** become an
  [infinite query](./infinite-queries). If you only used `merge` to keep
  references stable across refetches, drop it: structural sharing returns the
  previous object for every plain object or array subtree that did not
  change.

## Step 3: components

### Reading results

`data` and `error` are `Option`s, not `undefined`. Check the flags first, and
TypeScript narrows `data`:

```tsx
function PostTitle({ id }: { id: number }) {
  const post = usePostQuery(id);
  if (post.isPending) return <p>Loading…</p>;
  if (post.isError)
    return (
      <p>
        {Option.match(post.error, {
          onNone: () => "Something went wrong",
          onSome: (e) => e.message,
        })}
      </p>
    );
  return <h1>{post.data.value.title}</h1>;
}
```

If many components feed results into helpers that expect RTK's shape
(`data?: T`, `isLoading`), write **one** adapter
(`data: Option.getOrUndefined(result.data)`, …) next to the runtime and use it
everywhere, rather than converting each helper at once.

::: tip On 1.2.0? Assign hook results before passing them on
Before 1.2.1, nesting the call inside another generic function
(`toLegacy(useQuery(q))`) could make TypeScript infer the data type as
`undefined`, with the error showing up far away in JSX props. Upgrade, or
assign the result first: `const posts = useQuery(q); return toLegacy(posts)`.
:::

### Mutations and `.unwrap()`

There is no `mutateAsync` or `.unwrap()`. For UI follow-ups, use callbacks.
`onError` receives the typed error as an `Option` (`None` for defects):

```tsx
const update = useMutation(updatePost);

update.mutate(post, {
  onSuccess: () => navigate("/posts"),
  onError: (_cause, _post, error) =>
    showToast(Option.match(error, { onNone: () => "Unexpected error", onSome: (e) => e.message })),
});
<button disabled={update.isPending}>Save</button>;
```

Where an API needs a Promise (a form library's awaited `onSubmit`, a
`try { await trigger(x).unwrap() }` flow), run `mutateEffect` through
`useRunEffect`. It updates the hook's `isPending` / `isError` like `mutate`
does. `promiseExit` never rejects, which is the closest thing to handling
`unwrap()` in a `try` / `catch`:

```ts
const run = useRunEffect();
const submit = async (next: Post) => {
  const exit = await run.promiseExit(
    mode === "edit" ? update.mutateEffect(next) : create.mutateEffect(next),
  );
  if (Exit.isSuccess(exit)) onDone(exit.value);
  else setFormError(Cause.pretty(exit.cause));
};
```

To use your own services in Effects run this way (here `ApiClient`), declare
them once; see [Declaring your services](./promises#declaring-your-services).
For route loaders and code outside components, see
[Promise boundaries](./promises#outside-react-the-runtime).

### Invalidation waits for the refetch

An RTK mutation settles when its request finishes; refetches of invalidated
queries run afterwards. Here the mutation stays **pending until the active
invalidated queries have refetched**, so `isPending` lasts a little longer
and `onSuccess` runs after the list is up to date. See
[Invalidation](./mutations#invalidation).

### Optimistic updates

RTK's `onQueryStarted` + `updateQueryData` + `patchResult.undo()` is one
helper:

```ts
export const deletePost = Mutation.make({
  run: (id: number) =>
    Effect.flatMap(ApiClient, (api) =>
      api.request("DELETE", `/posts/${id}`, { parse: () => undefined }),
    ),
  ...Mutation.optimisticUpdate(postsQuery, (posts, id) => posts.filter((p) => p.id !== id)),
});
```

It writes the update, rolls it back on failure, and refetches once the
mutation settles. See [Mutations](./mutations#optimistic-updates-via-the-cache).

## Step 4: slices become atoms

A slice is state plus reducers. Keep the reducers as pure functions, and hold
the state in an atom:

```ts
// filtersState.ts (was filtersSlice.ts)
interface Filters {
  readonly search: string;
  readonly onlyMine: boolean;
}

export const filtersAtom = Atom.make<Filters>({ search: "", onlyMine: false }).pipe(
  Atom.withEquality(Equal.equals),
);

// was a reducer; return the same object when nothing changes
export const setSearch = (state: Filters, search: string): Filters =>
  state.search === search ? state : { ...state, search };

// was a selector
export const onlyMineAtom = Atom.map(filtersAtom, (f) => f.onlyMine);
```

```tsx
function SearchBox() {
  const filters = useAtomValue(filtersAtom); // was useSelector
  const setFilters = useAtomSet(filtersAtom); // was useDispatch
  return (
    <input
      value={filters.search}
      onChange={(e) => setFilters((s) => setSearch(s, e.target.value))}
    />
  );
}
```

Existing reducer tests keep working against the pure functions almost
unchanged.

::: warning Equality is `Object.is`, not Immer's
An Immer reducer that changes nothing returns the **same** state object, so
`useSelector` does not re-render. An atom compares with `Object.is`, so a
transition that always returns a new object (`{ ...state }`) notifies every
reader. A component that writes to an atom inside an effect that depends on
that atom then loops: "Maximum update depth exceeded". Return the same object
for no-op transitions, or give the atom value equality with
`Atom.withEquality(Equal.equals)`.
:::

### Sharing the registry with code outside React

Thunks, listeners and auth callbacks that used to `dispatch` from outside
components need the registry. Create it yourself and pass it to the provider,
so React, plain code and query atoms share it:

```tsx
export const registry = AtomRegistry.make({ scheduleTask }); // scheduleTask from @effect/atom-react
export const logout = () => registry.set(sessionAtom, Option.none());

<QueryClientProvider runtime={runtime} registry={registry}>
  <App />
</QueryClientProvider>;
```

The provider also supplies this registry to the `@effect/atom-react` hooks,
so do **not** wrap the app in a separate `RegistryProvider` as well. See
[One app-wide registry](./react#one-app-wide-registry).

### Persisted state

Two mechanisms replace `redux-persist` / `redux-localstorage-simple`:

- **Client state** (a slice, a `use-local-storage-state` value): `Atom.kvs`
  from `effect/reactivity`, with an Effect `Schema` for the stored value.
- **The query cache**: `QueryPersister.layer` with `persist: { schema }` on
  the queries that opt in. See [Persistence](./persistence).

`Atom.kvs` behaves differently from most React storage hooks: the default
value is fixed when the atom is defined, a missing key is written with the
default on first read, and changes from other tabs (`storage` events) or an
external `localStorage.removeItem` are not picked up.

Persisted keys get new names, so users lose stored state once after the
deploy unless you migrate the old keys. If the app clears storage by prefix
(for example at login), give persisted atoms a prefix that this clear does
not match.

## Step 5: tests

Most of RTK's test setup disappears.

| RTK test setup                               | effect-atom-query                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| `setupApiStore(api)` + global `fetch` mocks  | a fake `ApiClient` layer in the test runtime                                          |
| `store.dispatch(api.endpoints.x.initiate())` | `runtime.runPromise(Effect.flatMap(QueryClient.QueryClient, (c) => c.fetchQuery(q)))` |
| `preloadedState`                             | `registry.set(atom, fixture)` before rendering                                        |
| asserting dispatched actions                 | asserting `registry.get(atom)`                                                        |
| `vi.spyOn(api, "useGetPostQuery")`           | mock your named hook (`usePostQuery`), returning `QueryResult.success(...)`           |

A fake service replaces the network:

```ts
const FakeApiClient = Layer.succeed(
  ApiClient,
  ApiClient.of({
    request: (method, path, { parse }) =>
      path === "/posts/1"
        ? Effect.sync(() => parse({ id: 1, title: "Hello" }))
        : Effect.fail(new ApiError({ status: 404, message: "Not found" })),
  }),
);
const runtime = ManagedRuntime.make(
  QueryClient.layer({ defaultOptions: { queries: { retry: false } } }).pipe(
    Layer.provideMerge(FakeApiClient),
  ),
);
```

To test a loading state, return an Effect that does not complete yet
(`Effect.never`, or a `Deferred` you complete later in the test).

If you mock hooks rather than render with a client, the
[result constructors](./testing#mocking-hooks) build correctly shaped
results. A per-endpoint hook (`usePostQuery`) is easier to mock than the
generic `useQuery`, which is one more reason to keep named wrappers.

::: warning On 1.2.0? Mind the teardown order
Before 1.2.1, a test that passed its own `registry` to `QueryClientProvider`
and disposed it in `afterEach` got an unhandled "registry is disposed" error,
because Vitest runs `afterEach` before React Testing Library unmounts the
tree. Upgrade, or unmount first: call `cleanup()`, wait a tick, then
dispose.
:::

## Pitfalls checklist

These came up in a real migration of a mid-sized RTK app. Each one passed
type-checking and was caught only by tests.

- **Re-render loops.** Atom equality is `Object.is`; Immer returned the same
  reference for no-op updates. See [Step 4](#step-4-slices-become-atoms).
- **Empty error messages.** `Data.TaggedError` gives every error a `message`
  of `""`. Helpers that prefer `error.message` over a fallback then show an
  empty alert. RTK's error objects had no `message` at all. Give your API
  error a real `message` (a field, as above, or a getter).
- **`staleTime: "static"` ignores invalidation.** Use `"Infinity"`.
- **Refetch on focus and reconnect are on by default.** RTK needed
  `setupListeners` for them.
- **Storage cleared at login.** Persisted atoms under the same prefix as
  storage that gets cleared lose their state.
- **Persisted keys renamed.** Migrate them, or accept a one-time loss.
- **Base URL read later.** A layer reads configuration when the runtime is
  built, not when the module is imported.
- **`rules-of-hooks` and `Service.use`.** The React hooks lint rule treats
  `ApiClient.use(...)` as a hook call and reports it outside components,
  including in query definitions. Use `Effect.flatMap(ApiClient, ...)` or
  `Effect.gen` instead.
- **Remove the store from test utilities first.** If a shared `render`
  helper imports the Redux store, deleting any slice breaks every spec at
  import time. Switch the test utilities to the new provider before deleting
  slices.

## A migration order that works

1. Add the `ApiClient` service, the runtime and `QueryClientProvider` next to
   the Redux `Provider`. Both can run side by side.
2. Switch the shared test utilities to provide the runtime and registry.
3. Port one API slice at a time: definitions, named hooks, then the
   components and specs that use them. Port each slice's specs with it.
4. Port the Redux slices to atoms, keeping their reducer tests.
5. Remove the Redux `Provider`, the store and the packages.
