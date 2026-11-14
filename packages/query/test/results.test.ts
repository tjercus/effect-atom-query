import { describe, expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
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
