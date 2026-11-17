import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { KeyValueStore } from "effect/persistence";
import * as React from "react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  Query,
  QueryClient,
  QueryClientProvider,
  QueryPersister,
  useIsRestoring,
  useQuery,
  useSuspenseQuery,
} from "../src/index.ts";
import { counter } from "./utils.tsx";

const runtimes: Array<ManagedRuntime.ManagedRuntime<any, any>> = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    await runtime.dispose();
  }
  localStorage.clear();
});

const localStore = KeyValueStore.layerStorage(() => localStorage);

/** localStorage whose reads take 30 ms, like an async IndexedDB store. */
const slowStore = Layer.effect(
  KeyValueStore.KeyValueStore,
  Effect.map(KeyValueStore.KeyValueStore, (store) => ({
    ...store,
    get: (key: string) => store.get(key).pipe(Effect.delay("30 millis")),
  })),
).pipe(Layer.provide(localStore));

const makeRuntime = (
  options: QueryPersister.Options = {},
  store: Layer.Layer<KeyValueStore.KeyValueStore> = localStore,
) => {
  const runtime = ManagedRuntime.make(
    QueryPersister.layer({ throttle: "5 millis", ...options }).pipe(
      Layer.provideMerge(QueryClient.layer()),
      Layer.provide(store),
    ),
  );
  runtimes.push(runtime);
  return runtime;
};

const settingsQuery = (runs: ReturnType<typeof counter>) =>
  Query.single({
    key: ["settings"],
    run: Effect.sync(() => ({ theme: `theme ${runs.next()}` })).pipe(Effect.delay("10 millis")),
    staleTime: "1 hour",
    persist: { schema: Schema.Struct({ theme: Schema.String }) },
  });

const persistOnce = async () => {
  const runtime = makeRuntime();
  const query = settingsQuery(counter());
  const { result } = renderHook(() => useQuery(query), {
    wrapper: ({ children }) => (
      <QueryClientProvider runtime={runtime}>{children}</QueryClientProvider>
    ),
  });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  await runtime.dispose(); // writes the final snapshot
  runtimes.splice(runtimes.indexOf(runtime), 1);
};

describe("persistence in React", () => {
  it("restores synchronously: the first render already has the data, nothing is fetched", async () => {
    await persistOnce();
    expect(localStorage.getItem("effect-atom-query")).toContain("theme 1");

    const runs = counter();
    const query = settingsQuery(runs);
    const runtime = makeRuntime();
    const renders: Array<string> = [];
    function Settings() {
      const r = useQuery(query);
      renders.push(r.isSuccess ? r.data.value.theme : r.status);
      return null;
    }
    render(
      <QueryClientProvider runtime={runtime}>
        <Settings />
      </QueryClientProvider>,
    );
    expect(renders[0]).toBe("theme 1");
    await new Promise((r) => setTimeout(r, 30));
    expect(runs.count).toBe(0);
  });

  it("background restore: useIsRestoring, no mount fetch, suspense waits", async () => {
    await persistOnce();
    const runs = counter();
    const query = settingsQuery(runs);
    const runtime = makeRuntime({ restore: "background" }, slowStore);
    const seen: Array<string> = [];
    function Settings() {
      const restoring = useIsRestoring();
      const r = useQuery(query);
      seen.push(`${restoring}/${r.status}/${r.fetchStatus}`);
      return <p>{r.isSuccess ? r.data.value.theme : "…"}</p>;
    }
    function SuspenseSettings() {
      return <p>suspense {useSuspenseQuery(query).data.value.theme}</p>;
    }
    render(
      <QueryClientProvider runtime={runtime}>
        <Settings />
        <React.Suspense fallback={<p>restoring…</p>}>
          <SuspenseSettings />
        </React.Suspense>
      </QueryClientProvider>,
    );
    expect(seen[0]).toBe("true/pending/idle");
    expect(screen.getByText("restoring…")).toBeTruthy();
    expect(await screen.findByText("suspense theme 1")).toBeTruthy();
    expect(screen.getByText("theme 1")).toBeTruthy();
    expect(seen.at(-1)).toBe("false/success/idle");
    expect(runs.count).toBe(0);
  });
});
