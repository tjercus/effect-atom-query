import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { expectTypeOf } from "vite-plus/test";
import { Mutation, Query, QueryKey } from "../src/index.ts";

describe("QueryKey", () => {
  it("compares structurally, ignoring property order", () => {
    assert.isTrue(
      QueryKey.equals(["todos", { page: 1, done: true }], ["todos", { done: true, page: 1 }]),
    );
    assert.isFalse(QueryKey.equals(["todos", 1], ["todos", 2]));
  });

  it("matches prefixes and partial objects", () => {
    assert.isTrue(QueryKey.matches(["todos", 1], ["todos"]));
    assert.strictEqual(
      QueryKey.matches(["todos", { done: true, page: 2 }], ["todos", { done: true }]),
      true,
    );
    assert.isFalse(QueryKey.matches(["todos", { done: false }], ["todos", { done: true }]));
    assert.isFalse(QueryKey.matches(["todos"], ["todos", 1]));
    assert.isFalse(QueryKey.matches(["users", 1], ["todos"]));
  });
});

describe("QueryKey.make", () => {
  it("returns the key as a tuple", () => {
    const all = QueryKey.make("posts");
    const detail = (id: number) => QueryKey.make(...all, "detail", id);
    assert.deepStrictEqual(all, ["posts"]);
    assert.deepStrictEqual(detail(1), ["posts", "detail", 1]);
    assert.isTrue(QueryKey.matches(detail(1), all));
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
    assert.doesNotThrow(() => QueryKey.make(...widened));
    // @ts-expect-error the first element must be a string
    assert.deepStrictEqual(QueryKey.make(1, 2), [1, 2]);
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
    assert.deepStrictEqual(postQuery(1).key, ["posts", "detail", 1]);
    assert.deepStrictEqual(save.options.invalidates, [["posts"]]);
  });
});
