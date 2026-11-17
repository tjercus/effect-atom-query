import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Result } from "effect";
import { jsonKey, keyLabel } from "../src/internal/jsonKey.ts";
import { Mutation, QueryInspector } from "../src/index.ts";
import { setup } from "./utils.ts";

/** A key part JSON cannot hold. */
const unserialisable = {
  toJSON: () => {
    throw new Error("no JSON");
  },
  toString: () => "unserialisable",
};

describe("jsonKey", () => {
  it("returns the JSON key, or the error as a value", () => {
    assert.deepStrictEqual(jsonKey(["a", 1]), Result.succeed('["a",1]'));
    assert.isTrue(Result.isFailure(jsonKey([unserialisable])));
  });

  it("labels keys JSON cannot hold without throwing", () => {
    assert.strictEqual(keyLabel(["a", 1]), '["a",1]');
    assert.strictEqual(keyLabel(["a", unserialisable]), "[a,unserialisable]");
  });

  it.effect("lets mutations and the inspector use such keys", () =>
    Effect.gen(function* () {
      assert.doesNotThrow(() => Mutation.make({ key: [unserialisable], run: () => Effect.void }));
      const { client } = yield* setup();
      yield* client.setQueryData(["bad", unserialisable], () => Option.some(1));
      assert.deepStrictEqual(
        QueryInspector.queries(client).map((q) => q.hash),
        ["[bad,unserialisable]"],
      );
    }),
  );
});
