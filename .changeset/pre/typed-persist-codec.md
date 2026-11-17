---
"@effect-atom-query/query": patch
---

Persistence no longer crashes or silently hides bugs on data it cannot store:

- A persisted query whose key JSON cannot hold (a cycle, a throwing `toJSON`) no longer throws when its atom is mounted; it is simply not persisted.
- A persist schema whose transform or validator throws is now reported once with `console.warn`; the value is still skipped. Data the schema rejects is skipped without a warning, as before.
