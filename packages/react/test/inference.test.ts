/**
 * Type-level tests: hooks infer their data type from the query and `select`,
 * never from the context their result is passed into (report: a nested
 * `adapt(useQuery(q))` inferred `B` as `undefined`).
 *
 * The hooks are only called inside functions that never run; `vp check`
 * type-checks them.
 */
import { Effect, Option } from "effect";
import { describe, expectTypeOf, it } from "vite-plus/test";
import {
  InfiniteQuery,
  Query,
  queriesEntry,
  type UseQueryResult,
  useInfiniteQuery,
  useQuery,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from "../src/index.ts";

const numberQuery = Query.single({ key: ["n"], run: Effect.succeed(1) });
const definedQuery = Query.single({
  key: ["defined"],
  run: Effect.succeed(1),
  initialData: () => 0,
});
const feedQuery = InfiniteQuery.make({
  key: () => ["feed"],
  run: (_: void, page: number) => Effect.succeed(page),
  initialPageParam: 0,
  getNextPageParam: (last) => Option.some(last + 1),
})();

/** Generic helpers like an app's legacy result adapters. */
declare function adapt<T>(result: { readonly data: Option.Option<T> }): { data: T | undefined };
declare function unwrap<T>(result: { data: T | undefined }): T;
declare function pages<T>(result: { readonly data: Option.Option<{ pages: T }> }): T;

describe("hook data types", () => {
  it("useQuery ignores the return context without select", () => {
    const run = () => unwrap(adapt(useQuery(numberQuery)));
    expectTypeOf(run).returns.toEqualTypeOf<number>();
  });

  it("useQuery infers B from select", () => {
    const run = () => unwrap(adapt(useQuery(numberQuery, { select: (n) => String(n) })));
    expectTypeOf(run).returns.toEqualTypeOf<string>();
    const direct = () => useQuery(numberQuery, { select: (n) => n > 0 });
    expectTypeOf(direct).returns.toEqualTypeOf<UseQueryResult<boolean, never>>();
  });

  it("useQuery with initialData ignores the return context", () => {
    const run = () => unwrap(adapt(useQuery(definedQuery)));
    expectTypeOf(run).returns.toEqualTypeOf<number>();
  });

  it("useQuery with a skipped query ignores the return context", () => {
    const family = Query.make({ key: (id: number) => ["n", id], run: (id) => Effect.succeed(id) });
    const id = 1 as number | undefined;
    const run = () => unwrap(adapt(useQuery(family(id ?? Query.skipToken))));
    expectTypeOf(run).returns.toEqualTypeOf<number>();
  });

  it("useSuspenseQuery ignores the return context", () => {
    const run = () => unwrap(adapt(useSuspenseQuery(numberQuery)));
    expectTypeOf(run).returns.toEqualTypeOf<number>();
  });

  it("useInfiniteQuery ignores the return context", () => {
    const run = () => pages(useInfiniteQuery(feedQuery));
    expectTypeOf(run).returns.toEqualTypeOf<ReadonlyArray<number>>();
  });

  it("useSuspenseInfiniteQuery ignores the return context", () => {
    const run = () => pages(useSuspenseInfiniteQuery(feedQuery));
    expectTypeOf(run).returns.toEqualTypeOf<ReadonlyArray<number>>();
  });

  it("queriesEntry ignores the return context", () => {
    const entry = () => takeEntry(queriesEntry(numberQuery));
    expectTypeOf(entry).returns.toEqualTypeOf<number>();
    const selected = () => takeEntry(queriesEntry(numberQuery, { select: (n) => [n] }));
    expectTypeOf(selected).returns.toEqualTypeOf<Array<number>>();
  });
});

declare function takeEntry<B>(entry: { readonly select?: ((a: any) => B) | undefined }): B;
