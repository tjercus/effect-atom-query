# Devtools

```sh
pnpm add -D @effect-atom-query/devtools
```

```tsx
import { QueryDevtools } from "@effect-atom-query/devtools";

<QueryClientProvider runtime={runtime}>
  <App />
  <QueryDevtools /> {/* floating toggle, bottom right */}
</QueryClientProvider>;
```

The panel lists every cached query with its status (fresh, fetching, paused,
stale, inactive, error) and observer count. Select a query to see:

- its key, status, last update, `staleTime` and `gcTime`, and whether it is
  disabled, invalidated or persisted;
- its data, error (`Cause.pretty`) and `meta`;
- **Refetch**, **Invalidate**, **Reset**, **Cancel** and **Remove** buttons.

A **Mutations** tab shows executions with their variables, data, error and
paused state. You can filter by key and sort by status, key or last update.

| prop            | default          |
| --------------- | ---------------- |
| `initialIsOpen` | `false`          |
| `position`      | `"bottom-right"` |
| `height`        | `"40vh"`         |
| `client`        | the provider's   |

`QueryDevtoolsPanel` is the panel without the toggle, for embedding.

Both components render nothing when `process.env.NODE_ENV === "production"`,
and bundlers remove the panel code from production builds. The size budget
checks this. Without a bundler (native ESM in the browser), define
`process.env.NODE_ENV` yourself.

## Coming from TanStack Query devtools

`@effect-atom-query/devtools` replaces `@tanstack/react-query-devtools`: it
shows the same information (key, status, staleness, observers, data and error)
and has the same actions (refetch, invalidate, reset, cancel, remove). It works
inside your app, so there is no browser extension to install.

## Building your own tools

The panel is built on `QueryInspector` from the core package. It is a small
public API that returns snapshots as plain data, so you can log the cache or
build your own view without React.

```ts
QueryInspector.queries(client); // ReadonlyArray<QuerySnapshot>
QueryInspector.mutations(client); // ReadonlyArray<MutationSnapshot>, oldest first
QueryInspector.subscribe(client, () => {}); // returns an unsubscribe function
QueryInspector.action(client, key, "invalidate"); // Effect<void>; or refetch, reset, cancel, remove
QueryInspector.run(client, effect); // run an action without Effect code, fire and forget
```

A `QuerySnapshot` has the `key` and its `hash` (canonical JSON, for display and
search), `status`, `fetchStatus`, `observers`, `isActive`, `isStale`,
`isDisabled`, `isInvalidated`, `data`, `error` (as `Cause.pretty`),
`dataUpdatedAt`, `errorUpdatedAt`, `failureCount`, `staleTime`, `gcTime`,
`persisted` and `meta`. A `MutationSnapshot` has the mutation's `key`, `status`,
`isPaused`, `variables`, `data`, `error`, `failureCount` and `submittedAt`.

### Example: log the cache during development

```tsx
import { QueryInspector } from "@effect-atom-query/query";
import { useQueryClient } from "@effect-atom-query/react";
import { Option } from "effect";
import { useEffect } from "react";

function CacheLogger() {
  const client = useQueryClient();
  useEffect(
    () =>
      QueryInspector.subscribe(client, () => {
        console.table(
          QueryInspector.queries(client).map((q) => ({
            key: q.hash,
            status: q.status,
            fetching: q.fetchStatus,
            stale: q.isStale,
            observers: q.observers,
            error: Option.getOrElse(q.error, () => ""),
          })),
        );
      }),
    [client],
  );
  return null;
}
```

Render `<CacheLogger />` inside the `QueryClientProvider`. To use the inspector
outside React, get the client from the runtime instead:
`runtime.runSync(QueryClient.QueryClient)`.

Notifications are batched on a microtask. `isStale` changes as time passes
without a notification, so poll for it if you need to show it live.
