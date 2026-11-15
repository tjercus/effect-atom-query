---
"@effect-atom-query/query": patch
---

Closing the client no longer refetches query atoms that are still mounted in a registry (`registry.mount`, `useAtomValue`, code outside React). When the client shut down, each such atom rebuilt itself against the closing cache and started one more fetch. Mounted atoms now keep their last result, and a query atom first read after shutdown returns a disabled result without fetching. The `use*Query` hooks were not affected.
