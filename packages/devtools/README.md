# @effect-atom-query/devtools

An in-app devtools panel for [effect-atom-query](https://github.com/tjercus/effect-atom-query).
It inspects the query and mutation caches (status, data, errors, timings) and
can refetch, invalidate, reset, cancel or remove a query.

```sh
pnpm add -D @effect-atom-query/devtools
```

```tsx
import { QueryDevtools } from "@effect-atom-query/devtools";

<QueryClientProvider runtime={runtime}>
  <App />
  <QueryDevtools /> {/* floating toggle; QueryDevtoolsPanel embeds the panel */}
</QueryClientProvider>;
```

Props: `initialIsOpen`, `position` (`"bottom-right"` etc.), `height`, and
`client`. Both components render nothing when `process.env.NODE_ENV` is
`"production"`, and bundlers drop the panel code.

Documentation: <https://tjercus.github.io/effect-atom-query/>

MIT © tjercus
