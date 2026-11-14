import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { Effect } from "effect";
import { FocusManager, OnlineManager } from "../src/index.ts";

/** A stand-in for `window` with real event dispatch. */
const fakeWindow = () => {
  const target = new EventTarget();
  vi.stubGlobal("window", target);
  return target;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FocusManager", () => {
  it("defaults to focused outside the browser and never wires events", () => {
    const manager = FocusManager.make();
    const seen: Array<boolean> = [];
    const unsubscribe = manager.subscribe((f) => seen.push(f));
    expect(manager.isFocused()).toBe(true);
    unsubscribe();
    expect(seen).toEqual([]);
  });

  it("follows visibilitychange in the browser and removes the listener on cleanup", () => {
    const win = fakeWindow();
    let visibility: "visible" | "hidden" = "visible";
    vi.stubGlobal("document", {
      get visibilityState() {
        return visibility;
      },
    });
    const manager = FocusManager.make();
    const seen: Array<boolean> = [];
    const unsubscribe = manager.subscribe((f) => seen.push(f));
    expect(manager.isFocused()).toBe(true);

    visibility = "hidden";
    win.dispatchEvent(new Event("visibilitychange"));
    expect(manager.isFocused()).toBe(false);
    // the same state twice notifies once
    win.dispatchEvent(new Event("visibilitychange"));
    visibility = "visible";
    win.dispatchEvent(new Event("visibilitychange"));
    expect(seen).toEqual([false, true]);

    unsubscribe();
    visibility = "hidden";
    win.dispatchEvent(new Event("visibilitychange"));
    expect(seen).toEqual([false, true]);
  });

  it("an explicit value from setup or setFocused overrides the environment", () => {
    let emit: (focused?: boolean) => void = () => {};
    let cleanups = 0;
    const manager = FocusManager.make({
      isFocused: () => true,
      setup: (onFocus) => {
        emit = onFocus;
        return () => cleanups++;
      },
    });
    const seen: Array<boolean> = [];
    const a = manager.subscribe((f) => seen.push(f));
    const b = manager.subscribe(() => {});
    emit(false);
    expect(manager.isFocused()).toBe(false);
    manager.setFocused(undefined); // back to the environment
    expect(manager.isFocused()).toBe(true);
    expect(seen).toEqual([false, true]);
    a();
    expect(cleanups).toBe(0); // still one listener
    b();
    expect(cleanups).toBe(1);
  });

  it.effect("the layer and accessors use the provided manager", () =>
    Effect.gen(function* () {
      const focused = yield* Effect.gen(function* () {
        const before = yield* FocusManager.isFocused;
        yield* FocusManager.setFocused(false);
        return [before, yield* FocusManager.isFocused];
      }).pipe(Effect.provide(FocusManager.layer({ setup: () => () => {}, isFocused: () => true })));
      expect(focused).toEqual([true, false]);
    }),
  );
});

describe("OnlineManager", () => {
  it("starts online by default and does nothing outside the browser", () => {
    const manager = OnlineManager.make();
    const unsubscribe = manager.subscribe(() => {});
    expect(manager.isOnline()).toBe(true);
    unsubscribe();
    expect(OnlineManager.make({ initialOnline: false }).isOnline()).toBe(false);
  });

  it("follows online / offline events in the browser and removes them on cleanup", () => {
    const win = fakeWindow();
    const manager = OnlineManager.make();
    const seen: Array<boolean> = [];
    const unsubscribe = manager.subscribe((o) => seen.push(o));
    win.dispatchEvent(new Event("offline"));
    expect(manager.isOnline()).toBe(false);
    win.dispatchEvent(new Event("offline")); // no change, no notification
    win.dispatchEvent(new Event("online"));
    expect(seen).toEqual([false, true]);
    unsubscribe();
    win.dispatchEvent(new Event("offline"));
    expect(manager.isOnline()).toBe(true);
    expect(seen).toEqual([false, true]);
  });

  it("runs setup while it has listeners", () => {
    let setups = 0;
    let cleanups = 0;
    const manager = OnlineManager.make({
      setup: () => {
        setups++;
        return () => cleanups++;
      },
    });
    const a = manager.subscribe(() => {});
    const b = manager.subscribe(() => {});
    a();
    expect([setups, cleanups]).toEqual([1, 0]);
    b();
    expect([setups, cleanups]).toEqual([1, 1]);
    manager.subscribe(() => {});
    expect(setups).toBe(2);
  });

  it.effect("the layer and accessors use the provided manager", () =>
    Effect.gen(function* () {
      const states = yield* Effect.gen(function* () {
        const before = yield* OnlineManager.isOnline;
        yield* OnlineManager.setOnline(false);
        return [before, yield* OnlineManager.isOnline];
      }).pipe(Effect.provide(OnlineManager.layer({ setup: () => () => {} })));
      expect(states).toEqual([true, false]);
    }),
  );
});
