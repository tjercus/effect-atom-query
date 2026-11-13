import { Effect } from "effect";
import { AtomRegistry } from "effect/reactivity";
import { QueryClient } from "../src/index.ts";

/**
 * Let forked fibers and registry tasks run. Effect's scheduler uses
 * `setImmediate`, whose order relative to `setTimeout(0)` is not fixed, so
 * drain both a few times.
 */
export const settle = Effect.promise(async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
});

/**
 * A client bound to a fresh registry. Registry tasks (node removal on unmount)
 * run on microtasks, so `settle` flushes them.
 */
export const setup = (options?: QueryClient.Options) =>
  Effect.gen(function* () {
    const client = yield* QueryClient.make(options);
    const registry = AtomRegistry.make({
      initialValues: [QueryClient.initialValue(client)],
      scheduleTask: (f) => {
        let cancelled = false;
        queueMicrotask(() => {
          if (!cancelled) f();
        });
        return () => {
          cancelled = true;
        };
      },
    });
    yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
    return { client, registry };
  });

/** A counter for how often a query ran. */
export const counter = () => {
  let n = 0;
  return {
    get count() {
      return n;
    },
    tick: Effect.sync(() => ++n),
  };
};
