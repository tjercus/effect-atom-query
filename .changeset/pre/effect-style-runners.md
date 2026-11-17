---
"@effect-atom-query/query": patch
"@effect-atom-query/react": patch
---

Internal: Effect functions use `Effect.fnUntraced`, resuming paused mutations after a restore uses `Effect.forkDetach`, and `useRunEffect` runs Effects through the client's `runPromiseExit` instead of a hand-built Promise. No behavior change.
