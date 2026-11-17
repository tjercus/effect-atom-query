import { describe, expect, it } from "@effect/vitest";
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
    expect(jsonKey(["a", 1])).toEqual(Result.succeed('["a",1]'));
    expect(Result.isFailure(jsonKey([unserialisable]))).toBe(true);
  });

  it("labels keys JSON cannot hold without throwing", () => {
    expect(keyLabel(["a", 1])).toBe('["a",1]');
    expect(keyLabel(["a", unserialisable])).toBe("[a,unserialisable]");
  });

  it.effect("lets mutations and the inspector use such keys", () =>
    Effect.gen(function* () {
      expect(() => Mutation.make({ key: [unserialisable], run: () => Effect.void })).not.toThrow();
      const { client } = yield* setup();
      yield* client.setQueryData(["bad", unserialisable], () => Option.some(1));
      expect(QueryInspector.queries(client).map((q) => q.hash)).toEqual(["[bad,unserialisable]"]);
    }),
  );
});
