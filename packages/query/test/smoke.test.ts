import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";

describe("toolchain smoke test", () => {
  it.effect("runs Effects", () =>
    Effect.gen(function* () {
      const n = yield* Effect.succeed(41);
      expect(n + 1).toBe(42);
    }),
  );

  it("resolves Effect atoms", () => {
    const registry = AtomRegistry.make();
    const count = Atom.make(1);
    const doubled = Atom.make((get) => get(count) * 2);
    expect(registry.get(doubled)).toBe(2);
    registry.set(count, 5);
    expect(registry.get(doubled)).toBe(10);
  });
});
