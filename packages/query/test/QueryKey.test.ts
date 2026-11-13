import { describe, expect, it } from "@effect/vitest";
import { QueryKey } from "../src/index.ts";

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
