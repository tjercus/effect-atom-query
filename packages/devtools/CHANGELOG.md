# @effect-atom-query/devtools

## 1.4.0-next.2

### Patch Changes

- Updated dependencies [9b117f4]
- Updated dependencies [e3785cb]
  - @effect-atom-query/react@1.4.0-next.2
  - @effect-atom-query/query@1.4.0-next.2

## 1.4.0-next.1

### Patch Changes

- Updated dependencies
  - @effect-atom-query/react@1.4.0-next.1
  - @effect-atom-query/query@1.4.0-next.1

## 1.4.0-next.0

### Patch Changes

- 30c8c63: Keys JSON cannot hold no longer throw outside persistence:

  - `Mutation.make` with such a key no longer throws while building its label.
  - The "has no `run`" defect messages no longer throw while formatting the key.
  - Persisted storage that cannot be read now logs a warning instead of being ignored silently.
  - The devtools "ago" labels use the client's clock, so they agree with the snapshot times under a `TestClock`.

- 027d933: Fix persistence stopping on data that is not JSON, and stop hiding unexpected errors:

  - A query whose persisted data JSON cannot hold (a `bigint`, a cycle) is now skipped. Before, it made the whole snapshot fail to encode, which killed the persister's write and stopped all persisting.
  - `QueryClientProvider` no longer swallows errors thrown while unbinding the client, other than the ones unbinding is expected to cause.
  - The devtools only treat a missing `QueryClientProvider` as "no client".

- d4b523d: - New `useQueryClientOption()` in the react package: the provider's client as an `Option`, `None` outside a provider. The devtools use it instead of catching the error of `useQueryClient`.
  - Persisted data and mutation variables are stored as `JSON.stringify` writes them, whatever the schema. A value it cannot write (a bigint, a cycle) skips only that query or mutation, with one warning naming its key. An `undefined` field no longer keeps Standard Schema data from being persisted.
  - `QueryClientProvider` with its own `registry`: unmounting while a query atom is still mounted elsewhere no longer raises an uncaught `MissingQueryClientError`, and a disposed registry is no longer recognised by its error message.
  - A mutation state without the data or cause it should have is reported as a defect instead of being skipped or shown as a success.
  - Labels of keys whose parts cannot be turned into a string no longer throw.
- Updated dependencies [b282614]
- Updated dependencies [7122f2f]
- Updated dependencies [30c8c63]
- Updated dependencies [027d933]
- Updated dependencies [d4b523d]
- Updated dependencies [243c860]
- Updated dependencies [eb50a97]
  - @effect-atom-query/query@1.4.0-next.0
  - @effect-atom-query/react@1.4.0-next.0

## 1.3.1

### Patch Changes

- Updated dependencies [e80ede1]
- Updated dependencies [809b97e]
  - @effect-atom-query/query@1.3.1
  - @effect-atom-query/react@1.3.1

## 1.3.0

### Patch Changes

- Updated dependencies [fc77678]
- Updated dependencies [fc77678]
- Updated dependencies [aab5f8a]
- Updated dependencies [9abcd08]
- Updated dependencies [fc77678]
- Updated dependencies [df371c0]
- Updated dependencies [133c176]
- Updated dependencies [6a57f70]
  - @effect-atom-query/query@1.3.0
  - @effect-atom-query/react@1.3.0

## 1.2.0

First npm release of the 1.1.0 changes: 1.1.0 was tagged on GitHub but never published to npm. There are no code changes since 1.1.0; see the 1.1.0 entry below for what's new since 1.0.0.

### Patch Changes

- Updated dependencies
  - @effect-atom-query/query@1.2.0
  - @effect-atom-query/react@1.2.0

## 1.1.0

### Patch Changes

- 7157758: Accept React 19.0 and later as a peer dependency (was `^19.3.1`). CI now also runs the React bindings and devtools tests against React 19.0.0.
- Updated dependencies [cc42bf4]
- Updated dependencies [14869a4]
- Updated dependencies [7b266dd]
- Updated dependencies [3fb86ff]
- Updated dependencies [7157758]
  - @effect-atom-query/query@1.1.0
  - @effect-atom-query/react@1.1.0

## 1.0.0

### Major Changes

- 3cafd77: initial release

### Patch Changes

- Updated dependencies [3cafd77]
  - @effect-atom-query/query@1.0.0
  - @effect-atom-query/react@1.0.0
