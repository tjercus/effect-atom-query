import { assert, describe, expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import { AsyncResult } from "effect/reactivity";
import { Mutation, MutationObserver, MutationResult, Query, QueryResult } from "../src/index.ts";
import { settle, setup } from "./utils.ts";

class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {}) {}

/** The flags a hook mock needs to get right; timestamps and counters vary. */
const queryFlags = (r: QueryResult.QueryResult<unknown, unknown>) => ({
  status: r.status,
  fetchStatus: r.fetchStatus,
  isPending: r.isPending,
  isSuccess: r.isSuccess,
  isError: r.isError,
  isLoading: r.isLoading,
  isFetching: r.isFetching,
  isRefetching: r.isRefetching,
  isLoadingError: r.isLoadingError,
  isRefetchError: r.isRefetchError,
  isFetched: r.isFetched,
  isFetchedAfterMount: r.isFetchedAfterMount,
  isEnabled: r.isEnabled,
  isStale: r.isStale,
  data: r.data,
  error: r.error,
  resultTag: r.result._tag,
});

describe("QueryResult constructors", () => {
  it.effect("match the results of real queries", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const ok = Query.single({
        key: ["ok"],
        run: Effect.succeed(1).pipe(Effect.delay("1 second")),
      });
      const ko = Query.single({
        key: ["ko"],
        run: Effect.fail(new NotFound()).pipe(Effect.delay("1 second")),
        retry: false,
      });
      registry.mount(ok);
      registry.mount(ko);
      yield* settle;
      expect(queryFlags(QueryResult.pending())).toEqual(queryFlags(registry.get(ok)));
      yield* TestClock.adjust("1 second");
      yield* settle;
      expect(queryFlags(QueryResult.success(1))).toEqual(queryFlags(registry.get(ok)));
      expect(queryFlags(QueryResult.failure(new NotFound()))).toEqual(queryFlags(registry.get(ko)));
      expect(QueryResult.isDefect(QueryResult.failure(new NotFound()))).toBe(false);
    }),
  );

  it.effect("idle() matches a real disabled query", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const off = Query.single({ key: ["off"], run: Effect.succeed(1), enabled: false });
      registry.mount(off);
      yield* settle;
      expect(queryFlags(QueryResult.idle())).toEqual(queryFlags(registry.get(off)));
      expect(QueryResult.idle().isLoading).toBe(false);
    }),
  );

  it.effect("disabled() without an argument matches a skipped query", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const family = Query.make({ key: (id: number) => ["skip", id], run: Effect.succeed });
      const skipped = family(Query.skipToken);
      registry.mount(skipped);
      yield* settle;
      expect(queryFlags(QueryResult.disabled())).toEqual(queryFlags(registry.get(skipped)));
    }),
  );

  it("are deterministic: no timestamps from the clock", () => {
    const query = QueryResult.success(1).result;
    const mutation = MutationResult.success(4, 2).result;
    expect(query._tag === "Success" && query.timestamp).toBe(0);
    expect(mutation._tag === "Success" && mutation.timestamp).toBe(0);
  });
});

describe("MutationResult constructors", () => {
  it.effect("match the results of real mutations", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const m = Mutation.make({
        run: (n: number) =>
          (n > 0 ? Effect.succeed(n * 2) : Effect.fail(new NotFound())).pipe(
            Effect.delay("1 second"),
          ),
      });
      const observer = MutationObserver.make(client, m);
      observer.subscribe(() => {});
      // timestamps vary: AsyncResult.success stamps Date.now()
      const strip = (r: MutationResult.MutationResult<unknown, unknown, unknown, unknown>) => ({
        ...r,
        submittedAt: Option.none(),
        result: { ...r.result, timestamp: 0 },
      });
      expect(strip(MutationResult.idle())).toEqual(strip(observer.getCurrentResult()));

      observer.mutate(2);
      yield* settle;
      expect(strip(MutationResult.pending(2))).toEqual(strip(observer.getCurrentResult()));
      yield* TestClock.adjust("1 second");
      yield* settle;
      expect(strip(MutationResult.success(4, 2))).toEqual(strip(observer.getCurrentResult()));

      observer.mutate(0);
      yield* TestClock.adjust("1 second");
      yield* settle;
      expect(strip(MutationResult.failure(new NotFound(), 0))).toEqual(
        strip(observer.getCurrentResult()),
      );
    }),
  );
});

describe("QueryResult combinators", () => {
  const describeResult = (r: QueryResult.QueryResult<number, NotFound>) =>
    QueryResult.match(r, {
      onPending: (p) => `pending(${p.fetchStatus})`,
      onSuccess: (s) => `success(${s.data.value})`,
      onFailure: (f) => `failure(${Option.isSome(f.error) ? f.error.value._tag : "defect"})`,
    });

  it("match dispatches on the status", () => {
    expect(describeResult(QueryResult.pending())).toBe("pending(fetching)");
    expect(describeResult(QueryResult.success(3))).toBe("success(3)");
    expect(describeResult(QueryResult.failure(new NotFound()))).toBe("failure(NotFound)");
  });

  it.effect("isDefect is true only for failures without a typed error", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const boom = Query.single({ key: ["defect"], run: Effect.die("boom") });
      registry.mount(boom);
      yield* settle;
      const r = registry.get(boom);
      expect(r.status).toBe("error");
      expect(QueryResult.isDefect(r)).toBe(true);
      expect(describeResult(r as QueryResult.QueryResult<number, NotFound>)).toBe(
        "failure(defect)",
      );
      expect(QueryResult.isDefect(QueryResult.success(1))).toBe(false);
      expect(QueryResult.isDefect(QueryResult.pending())).toBe(false);
    }),
  );

  it("map keeps pending results as they are", () => {
    const pending = QueryResult.pending<number>();
    expect(QueryResult.map(pending, (n) => n + 1)).toBe(pending);
  });

  it("map rebuilds the data and AsyncResult of a success, keeping flags", () => {
    const base = { ...QueryResult.success(2), isFetching: true, isRefetching: true };
    const mapped = QueryResult.map(base, (n) => `#${n}`);
    expect(mapped.status).toBe("success");
    expect(mapped.data).toEqual(Option.some("#2"));
    expect(mapped.isRefetching).toBe(true);
    expect(mapped.result._tag).toBe("Success");
    expect(mapped.result.waiting).toBe(true);
    expect(mapped.result._tag === "Success" && mapped.result.value).toBe("#2");
    expect(mapped.result._tag === "Success" && mapped.result.timestamp).toBe(0);
  });

  it("map maps the previous data of a failure and keeps the cause", () => {
    const error = new NotFound();
    const withoutData = QueryResult.map(
      QueryResult.failure<number, NotFound>(error),
      (n) => n * 10,
    );
    expect(withoutData.data).toEqual(Option.none());
    expect(withoutData.status === "error" && withoutData.cause).toEqual(
      QueryResult.failure(error).cause,
    );
    expect(withoutData.result._tag).toBe("Failure");

    const withData = QueryResult.map(
      {
        ...QueryResult.failure<number, NotFound>(error),
        data: Option.some(4),
        isLoadingError: false,
        isRefetchError: true,
      },
      (n) => n * 10,
    );
    expect(withData.data).toEqual(Option.some(40));
    expect(withData.status === "error" && withData.isRefetchError).toBe(true);
    const result = withData.result;
    assert(result._tag === "Failure");
    expect(Option.map(result.previousSuccess, (s) => s.value)).toEqual(Option.some(40));
    expect(result.waiting).toBe(false);
  });

  it("disabled builds a pending, disabled, idle result", () => {
    const r = QueryResult.disabled<number, never>(AsyncResult.initial());
    expect(r).toMatchObject({
      status: "pending",
      isPending: true,
      isEnabled: false,
      fetchStatus: "idle",
      isLoading: false,
    });
    expect(r.data).toEqual(Option.none());
  });
});
