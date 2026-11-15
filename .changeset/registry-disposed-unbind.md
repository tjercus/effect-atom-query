---
"@effect-atom-query/react": patch
---

`QueryClientProvider` no longer throws `registry is disposed` as an uncaught error when an app-supplied `registry` is disposed before the provider's deferred unbind runs. This happened in every component test that disposed its registry in `afterEach`, because Vitest runs `afterEach` before React Testing Library unmounts the tree.
