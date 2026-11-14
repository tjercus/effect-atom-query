import type { QueryInspector } from "@effect-atom-query/query";
import { Data, Option } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { formatAgo, formatDuration, formatKey, formatValue, queryLabel } from "../src/format.ts";

describe("formatValue", () => {
  it("prints placeholders for values JSON cannot represent", () => {
    function namedFn() {}
    expect(formatValue(namedFn)).toBe('"[Function namedFn]"');
    expect(formatValue((() => () => {})())).toBe('"[Function anonymous]"');
    expect(formatValue(Symbol("tag"))).toBe('"Symbol(tag)"');
    expect(formatValue(undefined)).toBe('"[undefined]"');
    expect(formatValue(null)).toBe("null");
    expect(formatValue("text")).toBe('"text"');
  });

  it("prints sets and map entries recursively", () => {
    expect(JSON.parse(formatValue(new Set([1, 2n])))).toEqual({ _id: "Set", values: [1, "2n"] });
    expect(JSON.parse(formatValue(new Map([[{ id: 1 }, [undefined]]])))).toEqual({
      _id: "Map",
      entries: [[{ id: 1 }, ["[undefined]"]]],
    });
  });

  it("uses toJSON, guarding against a toJSON that returns itself", () => {
    class Point extends Data.Class<{ x: number }> {}
    expect(JSON.parse(formatValue(new Point({ x: 1 })))).toMatchObject({ x: 1 });
    expect(formatValue({ toJSON: () => ({ nested: 3n }) })).toContain('"3n"');
    const selfish = {
      toJSON() {
        return this;
      },
    };
    expect(formatValue(selfish)).toBe('"[object]"');
  });

  it("stops at a maximum depth", () => {
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 60; i++) {
      const next = {};
      deep.child = next;
      deep = next;
    }
    expect(formatValue(root)).toContain('"[…]"');
  });

  it("truncates very long output", () => {
    const text = formatValue("x".repeat(60_000));
    expect(text.endsWith("… (truncated)")).toBe(true);
    expect(text.length).toBeLessThan(50_100);
  });

  it("reports values whose serialisation throws instead of throwing", () => {
    const hostile = {
      get boom() {
        throw new Error("nope");
      },
    };
    expect(formatValue(hostile)).toBe("[unserialisable: nope]");
    const hostileNonError = {
      get boom() {
        throw "raw";
      },
    };
    expect(formatValue(hostileNonError)).toBe("[unserialisable: raw]");
  });
});

describe("formatKey", () => {
  it("prints a compact one-line key", () => {
    expect(formatKey(["todos", { page: 1 }, 5n])).toBe('["todos",{"page":1},"5n"]');
  });

  it("falls back to String() when serialisation throws", () => {
    const hostile = {
      get boom() {
        throw new Error("nope");
      },
      toString: () => "hostile",
    };
    expect(formatKey(["a", hostile])).toBe("a,hostile");
  });
});

describe("formatAgo", () => {
  it("picks seconds, minutes or hours", () => {
    const now = 10_000_000;
    expect(formatAgo(now - 3_000, now)).toBe("3s ago");
    expect(formatAgo(now + 5_000, now)).toBe("0s ago");
    expect(formatAgo(now - 120_000, now)).toBe("2m ago");
    expect(formatAgo(now - 3 * 3_600_000, now)).toBe("3h ago");
  });
});

describe("formatDuration", () => {
  it("formats static, infinite, milliseconds, seconds and minutes", () => {
    expect(formatDuration("static")).toBe("static");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("Infinity");
    expect(formatDuration(250)).toBe("250ms");
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(90_000)).toBe("1.5m");
  });
});

describe("queryLabel", () => {
  const base: QueryInspector.QuerySnapshot = {
    id: 1,
    key: ["k"],
    hash: '["k"]',
    status: "success",
    fetchStatus: "idle",
    observers: 1,
    isActive: true,
    isStale: false,
    isDisabled: false,
    isInvalidated: false,
    data: Option.some(1),
    error: Option.none(),
    dataUpdatedAt: Option.some(0),
    errorUpdatedAt: Option.none(),
    dataUpdateCount: 1,
    failureCount: 0,
    staleTime: 0,
    gcTime: 0,
    persisted: false,
    meta: Option.none(),
  };

  it("follows TanStack's precedence", () => {
    expect(queryLabel({ ...base, fetchStatus: "fetching", status: "error" })).toBe("fetching");
    expect(queryLabel({ ...base, fetchStatus: "paused", status: "error" })).toBe("paused");
    expect(queryLabel({ ...base, status: "error", observers: 0 })).toBe("error");
    expect(queryLabel({ ...base, observers: 0, isStale: true })).toBe("inactive");
    expect(queryLabel({ ...base, isStale: true })).toBe("stale");
    expect(queryLabel(base)).toBe("fresh");
  });
});
