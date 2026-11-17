---
"@effect-atom-query/query": patch
"@effect-atom-query/react": patch
"@effect-atom-query/devtools": patch
---

Keys JSON cannot hold no longer throw outside persistence:

- `Mutation.make` with such a key no longer throws while building its label.
- The "has no `run`" defect messages no longer throw while formatting the key.
- Persisted storage that cannot be read now logs a warning instead of being ignored silently.
- The devtools "ago" labels use the client's clock, so they agree with the snapshot times under a `TestClock`.
