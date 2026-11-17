import { assert, afterEach, describe, it, vi } from "@effect/vitest";
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
    assert.isTrue(manager.isFocused());
    unsubscribe();
    assert.deepStrictEqual(seen, []);
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
    assert.isTrue(manager.isFocused());

    visibility = "hidden";
    win.dispatchEvent(new Event("visibilitychange"));
    assert.isFalse(manager.isFocused());
    // the same state twice notifies once
    win.dispatchEvent(new Event("visibilitychange"));
    visibility = "visible";
    win.dispatchEvent(new Event("visibilitychange"));
    assert.deepStrictEqual(seen, [false, true]);

    unsubscribe();
    visibility = "hidden";
    win.dispatchEvent(new Event("visibilitychange"));
    assert.deepStrictEqual(seen, [false, true]);
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
    assert.isFalse(manager.isFocused());
    manager.setFocused(undefined); // back to the environment
    assert.isTrue(manager.isFocused());
    assert.deepStrictEqual(seen, [false, true]);
    a();
    assert.strictEqual(cleanups, 0); // still one listener
    b();
    assert.strictEqual(cleanups, 1);
  });

  it.effect("the layer and accessors use the provided manager", () =>
    Effect.gen(function* () {
      const focused = yield* Effect.gen(function* () {
        const before = yield* FocusManager.isFocused;
        yield* FocusManager.setFocused(false);
        return [before, yield* FocusManager.isFocused];
      }).pipe(Effect.provide(FocusManager.layer({ setup: () => () => {}, isFocused: () => true })));
      assert.deepStrictEqual(focused, [true, false]);
    }),
  );
});

describe("OnlineManager", () => {
  it("starts online by default and does nothing outside the browser", () => {
    const manager = OnlineManager.make();
    const unsubscribe = manager.subscribe(() => {});
    assert.isTrue(manager.isOnline());
    unsubscribe();
    assert.isFalse(OnlineManager.make({ initialOnline: false }).isOnline());
  });

  it("follows online / offline events in the browser and removes them on cleanup", () => {
    const win = fakeWindow();
    const manager = OnlineManager.make();
    const seen: Array<boolean> = [];
    const unsubscribe = manager.subscribe((o) => seen.push(o));
    win.dispatchEvent(new Event("offline"));
    assert.isFalse(manager.isOnline());
    win.dispatchEvent(new Event("offline")); // no change, no notification
    win.dispatchEvent(new Event("online"));
    assert.deepStrictEqual(seen, [false, true]);
    unsubscribe();
    win.dispatchEvent(new Event("offline"));
    assert.isTrue(manager.isOnline());
    assert.deepStrictEqual(seen, [false, true]);
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
    assert.deepStrictEqual([setups, cleanups], [1, 0]);
    b();
    assert.deepStrictEqual([setups, cleanups], [1, 1]);
    manager.subscribe(() => {});
    assert.strictEqual(setups, 2);
  });

  it.effect("the layer and accessors use the provided manager", () =>
    Effect.gen(function* () {
      const states = yield* Effect.gen(function* () {
        const before = yield* OnlineManager.isOnline;
        yield* OnlineManager.setOnline(false);
        return [before, yield* OnlineManager.isOnline];
      }).pipe(Effect.provide(OnlineManager.layer({ setup: () => () => {} })));
      assert.deepStrictEqual(states, [true, false]);
    }),
  );
});
