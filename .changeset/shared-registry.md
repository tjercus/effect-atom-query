---
"@effect-atom-query/react": minor
---

`QueryClientProvider` accepts a `registry` prop: it binds the client into an existing `AtomRegistry` and provides it to hooks, instead of creating a fresh one. This lets React, plain code and query atoms share one app-wide registry.
