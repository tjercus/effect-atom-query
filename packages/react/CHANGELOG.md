# @effect-atom-query/react

## 1.2.0

### Minor Changes

- integration DX and lots of review findings in real world usage

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
