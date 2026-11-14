# Devtools

```sh
pnpm add -D @effect-native-query/devtools
```

```tsx
import { QueryDevtools } from "@effect-native-query/devtools";

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
checks this.

## Building your own tools

The panel is built on `QueryInspector` from the core package, a small public
API of plain snapshots:

```ts
QueryInspector.queries(client)   // ReadonlyArray<QuerySnapshot>
QueryInspector.mutations(client) // ReadonlyArray<MutationSnapshot>
QueryInspector.subscribe(client, () => ...)
yield* QueryInspector.action(client, key, "invalidate")
```
