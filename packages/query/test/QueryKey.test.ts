import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { expectTypeOf } from "vite-plus/test";
import { Mutation, Query, QueryKey } from "../src/index.ts";

describe("QueryKey", () => {
  it("compares structurally, ignoring property order", () => {
    expect(
      QueryKey.equals(["todos", { page: 1, done: true }], ["todos", { done: true, page: 1 }]),
    ).toBe(true);
    expect(QueryKey.equals(["todos", 1], ["todos", 2])).toBe(false);
  });

  it("matches prefixes and partial objects", () => {
    expect(QueryKey.matches(["todos", 1], ["todos"])).toBe(true);
    expect(QueryKey.matches(["todos", { done: true, page: 2 }], ["todos", { done: true }])).toBe(
      true,
    );
    expect(QueryKey.matches(["todos", { done: false }], ["todos", { done: true }])).toBe(false);
    expect(QueryKey.matches(["todos"], ["todos", 1])).toBe(false);
    expect(QueryKey.matches(["users", 1], ["todos"])).toBe(false);
  });
});

describe("QueryKey.make", () => {
  it("returns the key as a tuple", () => {
    const all = QueryKey.make("posts");
    const detail = (id: number) => QueryKey.make(...all, "detail", id);
    expect(all).toEqual(["posts"]);
    expect(detail(1)).toEqual(["posts", "detail", 1]);
    expect(QueryKey.matches(detail(1), all)).toBe(true);
  });

  it("infers a tuple type without as const", () => {
    const all = QueryKey.make("posts");
    const detail = (id: number) => QueryKey.make(...all, "detail", id);
    expectTypeOf(all).toEqualTypeOf<readonly ["posts"]>();
    expectTypeOf(detail).returns.toEqualTypeOf<readonly ["posts", "detail", number]>();
  });

  it("rejects keys that are not a tuple starting with a string", () => {
    const widened: Array<string> = ["posts"];
    // @ts-expect-error a widened array is not a key
    expect(() => QueryKey.make(...widened)).not.toThrow();
    // @ts-expect-error the first element must be a string
    expect(QueryKey.make(1, 2)).toEqual([1, 2]);
  });

  it("works as a definition key and in invalidates", () => {
    const postKeys = {
      all: QueryKey.make("posts"),
      detail: (id: number) => QueryKey.make("posts", "detail", id),
    };
    const postQuery = Query.make({
      key: (id: number) => postKeys.detail(id),
      run: (id) => Effect.succeed({ id }),
    });
    const save = Mutation.make({
      run: (id: number) => Effect.succeed(id),
      invalidates: [postKeys.all],
    });
    expect(postQuery(1).key).toEqual(["posts", "detail", 1]);
    expect(save.options.invalidates).toEqual([["posts"]]);
  });
});
