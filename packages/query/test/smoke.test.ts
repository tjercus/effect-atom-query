import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";

describe("toolchain smoke test", () => {
  it.effect("runs Effects", () =>
    Effect.gen(function* () {
      const n = yield* Effect.succeed(41);
      assert.strictEqual(n + 1, 42);
    }),
  );

  it("resolves Effect atoms", () => {
    const registry = AtomRegistry.make();
    const count = Atom.make(1);
    const doubled = Atom.make((get) => get(count) * 2);
    assert.strictEqual(registry.get(doubled), 2);
    registry.set(count, 5);
    assert.strictEqual(registry.get(doubled), 10);
  });
});
