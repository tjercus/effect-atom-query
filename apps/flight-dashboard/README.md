# Flight dashboard

An example app for what `effect-atom-query` adds on top of TanStack Query's
model. The [playground](../playground) covers what the two libraries share.

```sh
vp run dev:flights      # from the repository root
vp run flight-dashboard#test
```

## What it shows

**Swapping the backend as a layer.** The components and queries depend on the
`FlightApi` service only. The header picks the layer that provides it, and the
app builds a new runtime from it:

| layer                | what it is                                                         |
| -------------------- | ------------------------------------------------------------------ |
| `layerHttp()`        | `fetch` to a small API that the Vite dev and preview servers serve |
| `layerInMemory()`    | the same data, computed in the browser                             |
| `layerChaos(…)`      | a decorator around either one: latency, transient errors, defects  |
| `layerRequestLog(…)` | a decorator that records how each request ended (the request log)  |

All four are in [`src/api/layers.ts`](src/api/layers.ts), and the composition
is in [`src/runtime.ts`](src/runtime.ts).

**Typed errors.** `RateLimited`, `UpstreamUnavailable`, `FlightNotFound` and
`BadResponse` reach the components as a union. `describeError` in
[`src/components/status.tsx`](src/components/status.tsx) is an exhaustive
`switch`, so a new error does not compile until the UI handles it. Defects
(`Effect.die`) are not in the error type: `useQuery` throws them to the
panel's error boundary.

**Retries are a `Schedule`.** `flightRetry` in [`src/queries.ts`](src/queries.ts)
backs off exponentially with jitter, waits at least `retryAfterMs` after a
`RateLimited`, stops after four retries, and never retries a `FlightNotFound`.
The panels show the retry count and the typed reason while they retry.

**Cancellation is fiber interruption.** Typing in the search box cancels the
superseded search, and so does the Cancel button. Interrupting the fiber stops
the chaos delay, the retry schedule and the HTTP request. The request log
shows `cancelled`, and the browser's Network tab shows `(canceled)`. Swapping
the backend disposes the old runtime, which interrupts everything it was
running.

**Testing with the same layers.** The tests in [`test/`](test) use the app's
layers and query definitions:

- `retry.test.ts` tests the retry `Schedule` as an Effect with `TestClock`.
- `layers.test.ts` forces each chaos outcome with an injected random source.
- `Dashboard.test.tsx` renders the real components through `makeTestHarness`.

## Things to try

1. Turn on the chaos layer and raise "Typed failures": watch the retry count and the typed banners.
   The board keeps its last good data while a poll fails.
2. Look up `XX999`: `FlightNotFound` appears at once, with one request in the log.
3. Set extra latency to 3 s and type in the search box. Every keystroke cancels
   the search before it.
4. Raise the "Defects (crashes)" slider, the only setting that crashes a panel:
   the panel shows its error boundary, and the others keep working. In the
   search panel only the results crash, so you can keep typing.
5. Open the devtools panel (bottom right) to see each query's state and to
   cancel, refetch or invalidate a query.
