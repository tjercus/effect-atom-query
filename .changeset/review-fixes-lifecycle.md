---
"@effect-atom-query/query": patch
---

Fix three lifecycle defects:

- `client.clear` no longer interrupts running mutations, so it is safe to call from a mutation's own callback (a logout mutation, say): the mutation finishes, its callbacks run, and `useMutation` sees it settle. Closing the client still interrupts running mutations.
- `fetchQuery`, `prefetchQuery` and `ensureQueryData` follow the fetch that superseded the one they were waiting for (an `invalidateQueries` elsewhere), instead of failing with an interrupt. `cancelQueries` and `removeQueries` still interrupt the caller.
- An interrupted mutation goes back to `idle`. It is no longer reported as an error or defect, thrown to the error boundary, or passed to the `useMutation` callbacks.
