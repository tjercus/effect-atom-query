# @effect-atom-query/react

## 1.2.1

### Patch Changes

- fc77678: `useQuery`, `useSuspenseQuery`, `useInfiniteQuery` and `useSuspenseInfiniteQuery` infer their data type from the query and `select` only. Before, passing the result straight into another generic function (`adapt(useQuery(q))`) could make TypeScript infer the data type as `undefined`.
- fc77678: `QueryClientProvider` no longer throws `registry is disposed` as an uncaught error when an app-supplied `registry` is disposed before the provider's deferred unbind runs. This happened in every component test that disposed its registry in `afterEach`, because Vitest runs `afterEach` before React Testing Library unmounts the tree.
- fc77678: Documentation: `staleTime: "static"` is skipped by invalidation (use `"Infinity"` for "cached until invalidated"), `QueryClientProvider` provides the atom `RegistryContext`, and `mutateEffect` updates the hook's state like `mutate`. New guides: "Coming from Redux / RTK Query", plus sections on key constants, errors and structural sharing.
- Updated dependencies [fc77678]
- Updated dependencies [df371c0]
  - @effect-atom-query/query@1.2.1

## 1.2.0

First npm release of the 1.1.0 changes: 1.1.0 was tagged on GitHub but never published to npm. There are no code changes since 1.1.0; see the 1.1.0 entry below for what's new since 1.0.0.

### Patch Changes

- Updated dependencies
  - @effect-atom-query/query@1.2.0

## 1.1.0

### Minor Changes

- 7b266dd: `QueryClientProvider` accepts a `registry` prop: it binds the client into an existing `AtomRegistry` and provides it to hooks, instead of creating a fresh one. This lets React, plain code and query atoms share one app-wide registry.

### Patch Changes

- 7157758: Accept React 19.0 and later as a peer dependency (was `^19.3.1`). CI now also runs the React bindings and devtools tests against React 19.0.0.
- Updated dependencies [cc42bf4]
- Updated dependencies [14869a4]
- Updated dependencies [3fb86ff]
  - @effect-atom-query/query@1.1.0

## 1.0.0

### Major Changes

- 3cafd77: initial release

### Patch Changes

- Updated dependencies [3cafd77]
  - @effect-atom-query/query@1.0.0
