import { assert, describe, it } from "@effect/vitest";
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
      assert.deepStrictEqual(queryFlags(QueryResult.pending()), queryFlags(registry.get(ok)));
      yield* TestClock.adjust("1 second");
      yield* settle;
      assert.deepStrictEqual(queryFlags(QueryResult.success(1)), queryFlags(registry.get(ok)));
      assert.deepStrictEqual(
        queryFlags(QueryResult.failure(new NotFound())),
        queryFlags(registry.get(ko)),
      );
      assert.isFalse(QueryResult.isDefect(QueryResult.failure(new NotFound())));
    }),
  );

  it.effect("idle() matches a real disabled query", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const off = Query.single({ key: ["off"], run: Effect.succeed(1), enabled: false });
      registry.mount(off);
      yield* settle;
      assert.deepStrictEqual(queryFlags(QueryResult.idle()), queryFlags(registry.get(off)));
      assert.isFalse(QueryResult.idle().isLoading);
    }),
  );

  it.effect("disabled() without an argument matches a skipped query", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const family = Query.make({ key: (id: number) => ["skip", id], run: Effect.succeed });
      const skipped = family(Query.skipToken);
      registry.mount(skipped);
      yield* settle;
      assert.deepStrictEqual(queryFlags(QueryResult.disabled()), queryFlags(registry.get(skipped)));
    }),
  );

  it("are deterministic: no timestamps from the clock", () => {
    const query = QueryResult.success(1).result;
    const mutation = MutationResult.success(4, 2).result;
    assert.strictEqual(query._tag === "Success" && query.timestamp, 0);
    assert.strictEqual(mutation._tag === "Success" && mutation.timestamp, 0);
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
      assert.deepStrictEqual(strip(MutationResult.idle()), strip(observer.getCurrentResult()));

      observer.mutate(2);
      yield* settle;
      assert.deepStrictEqual(strip(MutationResult.pending(2)), strip(observer.getCurrentResult()));
      yield* TestClock.adjust("1 second");
      yield* settle;
      assert.deepStrictEqual(
        strip(MutationResult.success(4, 2)),
        strip(observer.getCurrentResult()),
      );

      observer.mutate(0);
      yield* TestClock.adjust("1 second");
      yield* settle;
      assert.deepStrictEqual(
        strip(MutationResult.failure(new NotFound(), 0)),
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
    assert.strictEqual(describeResult(QueryResult.pending()), "pending(fetching)");
    assert.strictEqual(describeResult(QueryResult.success(3)), "success(3)");
    assert.strictEqual(describeResult(QueryResult.failure(new NotFound())), "failure(NotFound)");
  });

  it.effect("isDefect is true only for failures without a typed error", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const boom = Query.single({ key: ["defect"], run: Effect.die("boom") });
      registry.mount(boom);
      yield* settle;
      const r = registry.get(boom);
      assert.strictEqual(r.status, "error");
      assert.isTrue(QueryResult.isDefect(r));
      assert.strictEqual(
        describeResult(r as QueryResult.QueryResult<number, NotFound>),
        "failure(defect)",
      );
      assert.isFalse(QueryResult.isDefect(QueryResult.success(1)));
      assert.isFalse(QueryResult.isDefect(QueryResult.pending()));
    }),
  );

  it("map keeps pending results as they are", () => {
    const pending = QueryResult.pending<number>();
    assert.strictEqual(
      QueryResult.map(pending, (n) => n + 1),
      pending,
    );
  });

  it("map rebuilds the data and AsyncResult of a success, keeping flags", () => {
    const base = { ...QueryResult.success(2), isFetching: true, isRefetching: true };
    const mapped = QueryResult.map(base, (n) => `#${n}`);
    assert.strictEqual(mapped.status, "success");
    assert.deepStrictEqual(mapped.data, Option.some("#2"));
    assert.isTrue(mapped.isRefetching);
    assert.strictEqual(mapped.result._tag, "Success");
    assert.isTrue(mapped.result.waiting);
    assert.strictEqual(mapped.result._tag === "Success" && mapped.result.value, "#2");
    assert.strictEqual(mapped.result._tag === "Success" && mapped.result.timestamp, 0);
  });

  it("map maps the previous data of a failure and keeps the cause", () => {
    const error = new NotFound();
    const withoutData = QueryResult.map(
      QueryResult.failure<number, NotFound>(error),
      (n) => n * 10,
    );
    assert.deepStrictEqual(withoutData.data, Option.none());
    assert.deepStrictEqual(
      withoutData.status === "error" && withoutData.cause,
      QueryResult.failure(error).cause,
    );
    assert.strictEqual(withoutData.result._tag, "Failure");

    const withData = QueryResult.map(
      {
        ...QueryResult.failure<number, NotFound>(error),
        data: Option.some(4),
        isLoadingError: false,
        isRefetchError: true,
      },
      (n) => n * 10,
    );
    assert.deepStrictEqual(withData.data, Option.some(40));
    assert.isTrue(withData.status === "error" && withData.isRefetchError);
    const result = withData.result;
    assert(result._tag === "Failure");
    assert.deepStrictEqual(
      Option.map(result.previousSuccess, (s) => s.value),
      Option.some(40),
    );
    assert.isFalse(result.waiting);
  });

  it("disabled builds a pending, disabled, idle result", () => {
    const r = QueryResult.disabled<number, never>(AsyncResult.initial());
    assert.deepInclude(r, {
      status: "pending",
      isPending: true,
      isEnabled: false,
      fetchStatus: "idle",
      isLoading: false,
    });
    assert.deepStrictEqual(r.data, Option.none());
  });
});
