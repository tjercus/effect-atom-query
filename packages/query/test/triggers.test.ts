import { assert, describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Option } from "effect";
import { TestClock } from "effect/testing";
import { Query, QueryObserver } from "../src/index.ts";
import { counter, settle, setup } from "./utils.ts";

const refocus = (focus: { setFocused: (f: boolean | undefined) => void }) =>
  Effect.gen(function* () {
    focus.setFocused(false);
    focus.setFocused(true);
    yield* settle;
  });

describe("refetchOnWindowFocus", () => {
  it.effect("refetches active stale queries when focus returns", () =>
    Effect.gen(function* () {
      const { registry, focus } = yield* setup();
      const runs = counter();
      const stale = Query.single({ key: ["focus-stale"], run: runs.tick });
      registry.mount(stale);
      yield* settle;
      expect(runs.count).toBe(1);
      yield* refocus(focus);
      expect(runs.count).toBe(2);
    }),
  );

  it.effect("respects staleTime, 'always' and false", () =>
    Effect.gen(function* () {
      const { registry, focus } = yield* setup();
      const fresh = counter();
      const always = counter();
      const never = counter();
      registry.mount(Query.single({ key: ["f1"], run: fresh.tick, staleTime: "1 minute" }));
      registry.mount(
        Query.single({
          key: ["f2"],
          run: always.tick,
          staleTime: "1 minute",
          refetchOnWindowFocus: "always",
        }),
      );
      registry.mount(Query.single({ key: ["f3"], run: never.tick, refetchOnWindowFocus: false }));
      yield* settle;
      yield* refocus(focus);
      expect([fresh.count, always.count, never.count]).toEqual([1, 2, 1]);
    }),
  );

  it.effect("ignores inactive queries and static ones", () =>
    Effect.gen(function* () {
      const { client, registry, focus } = yield* setup();
      const inactive = counter();
      const fixed = counter();
      yield* client.fetchQuery(Query.single({ key: ["inactive"], run: inactive.tick }));
      registry.mount(Query.single({ key: ["static"], run: fixed.tick, staleTime: "static" }));
      yield* settle;
      yield* refocus(focus);
      expect([inactive.count, fixed.count]).toEqual([1, 1]);
    }),
  );

  it.effect("can be overridden per observer", () =>
    Effect.gen(function* () {
      const { client, focus } = yield* setup();
      const runs = counter();
      const q = Query.single({ key: ["per-observer-focus"], run: runs.tick });
      QueryObserver.make(client, q, { refetchOnWindowFocus: false }).subscribe(() => {});
      yield* settle;
      yield* refocus(focus);
      expect(runs.count).toBe(1);
    }),
  );
});

describe("refetchOnReconnect", () => {
  it.effect("refetches active stale queries when the network returns", () =>
    Effect.gen(function* () {
      const { registry, online } = yield* setup();
      const runs = counter();
      const always = counter();
      registry.mount(Query.single({ key: ["reconnect"], run: runs.tick }));
      // networkMode "always" defaults refetchOnReconnect to false
      registry.mount(
        Query.single({ key: ["reconnect-always"], run: always.tick, networkMode: "always" }),
      );
      yield* settle;
      online.setOnline(false);
      online.setOnline(true);
      yield* settle;
      expect([runs.count, always.count]).toEqual([2, 1]);
    }),
  );
});

describe("networkMode", () => {
  it.effect("online: pauses a fetch started offline and continues on reconnect", () =>
    Effect.gen(function* () {
      const { client, registry, online } = yield* setup();
      const runs = counter();
      const q = Query.single({ key: ["paused"], run: runs.tick });
      online.setOnline(false);
      expect(QueryObserver.make(client, q).getCurrentResult().fetchStatus).toBe("paused"); // optimistic
      registry.mount(q);
      yield* settle;
      let r = registry.get(q);
      expect(r).toMatchObject({
        status: "pending",
        fetchStatus: "paused",
        isPaused: true,
        isLoading: false,
      });
      expect(runs.count).toBe(0);
      expect(yield* client.isFetching()).toBe(0); // paused is not fetching

      online.setOnline(true);
      yield* settle;
      r = registry.get(q);
      assert(r.isSuccess);
      expect(runs.count).toBe(1); // continued, not refetched twice
    }),
  );

  it.effect("online: pauses retries while offline", () =>
    Effect.gen(function* () {
      const { registry, online } = yield* setup();
      const runs = counter();
      const q = Query.single({
        key: ["retry-paused"],
        run: runs.tick.pipe(
          Effect.flatMap((n) => (n < 2 ? Effect.fail("flaky") : Effect.succeed(n))),
        ),
      });
      registry.mount(q);
      yield* settle;
      expect(runs.count).toBe(1);
      online.setOnline(false);
      yield* TestClock.adjust("1 second"); // retry delay elapses while offline
      yield* settle;
      expect(registry.get(q).fetchStatus).toBe("paused");
      expect(runs.count).toBe(1);
      online.setOnline(true);
      yield* settle;
      const r = registry.get(q);
      assert(r.isSuccess);
      expect(r.data.value).toBe(2);
    }),
  );

  it.effect("offlineFirst: runs the first attempt offline, pauses retries", () =>
    Effect.gen(function* () {
      const { registry, online } = yield* setup();
      const runs = counter();
      const q = Query.single({
        key: ["offline-first"],
        run: runs.tick.pipe(Effect.andThen(Effect.fail("offline"))),
        networkMode: "offlineFirst",
      });
      online.setOnline(false);
      registry.mount(q);
      yield* settle;
      expect(runs.count).toBe(1);
      yield* TestClock.adjust("1 second");
      yield* settle;
      expect(registry.get(q).fetchStatus).toBe("paused");
      expect(runs.count).toBe(1);
    }),
  );

  it.effect("always: ignores connectivity", () =>
    Effect.gen(function* () {
      const { registry, online } = yield* setup();
      const runs = counter();
      const q = Query.single({ key: ["always"], run: runs.tick, networkMode: "always" });
      online.setOnline(false);
      registry.mount(q);
      yield* settle;
      expect(registry.get(q).isSuccess).toBe(true);
    }),
  );
});

describe("refetchInterval", () => {
  it.effect("polls while observed and stops after unmount", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const runs = counter();
      const q = Query.single({ key: ["poll"], run: runs.tick, refetchInterval: "1 second" });
      const unmount = registry.mount(q);
      yield* settle;
      for (let i = 0; i < 3; i++) {
        yield* TestClock.adjust("1 second");
        yield* settle;
      }
      expect(runs.count).toBe(4);
      unmount();
      yield* settle;
      yield* TestClock.adjust("5 seconds");
      yield* settle;
      expect(runs.count).toBe(4);
    }),
  );

  it.effect("pauses in the background unless refetchIntervalInBackground", () =>
    Effect.gen(function* () {
      const { registry, focus } = yield* setup();
      const fg = counter();
      const bg = counter();
      registry.mount(Query.single({ key: ["fg"], run: fg.tick, refetchInterval: "1 second" }));
      registry.mount(
        Query.single({
          key: ["bg"],
          run: bg.tick,
          refetchInterval: "1 second",
          refetchIntervalInBackground: true,
        }),
      );
      yield* settle;
      focus.setFocused(false);
      for (let i = 0; i < 3; i++) {
        yield* TestClock.adjust("1 second");
        yield* settle;
      }
      expect([fg.count, bg.count]).toEqual([1, 4]);
    }),
  );

  it.effect("accepts a function of the result, re-evaluated after each fetch", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const runs = counter();
      const q = Query.single({
        key: ["poll-until"],
        run: runs.tick,
        refetchInterval: (r) => (r.isSuccess && (r.data.value as number) >= 3 ? false : "1 second"),
      });
      registry.mount(q);
      yield* settle;
      for (let i = 0; i < 6; i++) {
        yield* TestClock.adjust("1 second");
        yield* settle;
      }
      expect(runs.count).toBe(3);
    }),
  );

  it.effect("updates when an observer's options change", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const runs = counter();
      const q = Query.single({ key: ["poll-observer"], run: runs.tick });
      const observer = QueryObserver.make(client, q, {});
      observer.subscribe(() => {});
      yield* settle;
      observer.setOptions(q, { refetchInterval: "1 second" });
      yield* TestClock.adjust("1 second");
      yield* settle;
      expect(runs.count).toBe(2);
      observer.setOptions(q, { refetchInterval: false });
      yield* TestClock.adjust("3 seconds");
      yield* settle;
      expect(runs.count).toBe(2);
    }),
  );
});

describe("cancelQueries", () => {
  it.effect("interrupts a first fetch and reverts to pending/idle", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const q = Query.single({
        key: ["cancel"],
        run: Effect.succeed(1).pipe(Effect.delay("1 second")),
      });
      registry.mount(q);
      yield* settle;
      expect(registry.get(q).fetchStatus).toBe("fetching");
      yield* client.cancelQueries({ queryKey: ["cancel"] });
      yield* settle;
      expect(registry.get(q)).toMatchObject({ status: "pending", fetchStatus: "idle" });
      yield* TestClock.adjust("1 second");
      yield* settle;
      expect(registry.get(q).status).toBe("pending"); // never completed
    }),
  );

  it.effect("keeps previous data when a refetch is cancelled, and interrupts joiners", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      let n = 0;
      const q = Query.single({
        key: ["cancel-refetch"],
        run: Effect.sync(() => ++n).pipe(Effect.delay("1 second")),
      });
      registry.mount(q);
      yield* TestClock.adjust("1 second");
      yield* settle;
      registry.refresh(q);
      yield* settle;
      const joiner = yield* Effect.forkChild(client.fetchQuery(q, { staleTime: 0 }));
      yield* settle;
      yield* client.cancelQueries();
      const exit = yield* Fiber.await(joiner);
      expect(exit._tag).toBe("Failure");
      const r = registry.get(q);
      assert(r.isSuccess);
      expect(r.data).toEqual(Option.some(1));
      expect(r.fetchStatus).toBe("idle");
    }),
  );

  it.effect("revert: false keeps the progress of the cancelled fetch", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const q = Query.single({
        key: ["no-revert"],
        run: Effect.fail("x"),
        retry: Infinity as never,
      });
      registry.mount(q);
      yield* settle;
      expect(registry.get(q).failureCount).toBe(1);
      yield* client.cancelQueries(undefined, { revert: false });
      yield* settle;
      expect(registry.get(q)).toMatchObject({ fetchStatus: "idle", failureCount: 1 });
    }),
  );
});

describe("retryOnMount", () => {
  it.effect("false: an errored query without data does not refetch on mount", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const runs = counter();
      const q = Query.single({
        key: ["no-retry-on-mount"],
        run: runs.tick.pipe(Effect.andThen(Effect.fail("x"))),
        retry: false,
        retryOnMount: false,
      });
      registry.mount(q)();
      yield* settle;
      registry.mount(q);
      yield* settle;
      expect(runs.count).toBe(1);
      expect(registry.get(q).isError).toBe(true);
    }),
  );
});
