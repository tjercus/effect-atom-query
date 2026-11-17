import { assert, describe, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import { Result, Schema, SchemaGetter } from "effect";
import { infiniteCodec, persistCodec, type StandardSchema } from "../src/internal/persistCodec.ts";

const standard = <A>(validate: StandardSchema<A>["~standard"]["validate"]): StandardSchema<A> => ({
  "~standard": { version: 1, vendor: "test", validate },
});

const tagOf = (r: Result.Result<unknown, { readonly _tag: string }>) =>
  Result.isFailure(r) ? r.failure._tag : "Success";

describe("persistCodec", () => {
  it("returns Invalid, without throwing, for data an Effect Schema rejects", () => {
    const codec = persistCodec(Schema.Struct({ n: Schema.Number }));
    assert.strictEqual(tagOf(codec.decode({ n: "x" })), "Invalid");
    assert.deepStrictEqual(codec.decode({ n: 1 }), Result.succeed({ n: 1 }));
  });

  it("returns Invalid for data a Standard Schema rejects", () => {
    const codec = persistCodec(standard(() => ({ issues: [{ message: "nope" }] })));
    const r = codec.decode(1);
    assert.strictEqual(tagOf(r), "Invalid");
    assert.include(
      Result.isFailure(r) && r.failure._tag === "Invalid" && r.failure.message,
      "nope",
    );
  });

  it("returns Defect, and warns once, when an Effect Schema transform throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const boom = Schema.String.pipe(
      Schema.decodeTo(Schema.String, {
        decode: SchemaGetter.transform(() => {
          throw new Error("boom");
        }),
        encode: SchemaGetter.transform(() => {
          throw new Error("boom");
        }),
      }),
    );
    const codec = persistCodec(boom);
    assert.strictEqual(tagOf(codec.decode("a")), "Defect");
    assert.strictEqual(tagOf(codec.decode("b")), "Defect");
    assert.strictEqual(tagOf(codec.encode("c")), "Defect");
    // Once per direction: decoding and encoding are reported separately.
    assert.strictEqual(warn.mock.calls.length, 2);
    warn.mockRestore();
  });

  it("does not encode Standard Schema data: the persister checks it is JSON", () => {
    const codec = persistCodec(standard((value) => ({ value })));
    assert.deepStrictEqual(codec.encode({ n: 1n }), Result.succeed({ n: 1n }));
  });

  it("returns Defect when a Standard Schema validator throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const codec = persistCodec(
      standard(() => {
        throw new Error("boom");
      }),
    );
    assert.strictEqual(tagOf(codec.decode(1)), "Defect");
    assert.strictEqual(warn.mock.calls.length, 1);
    warn.mockRestore();
  });

  it("returns Unsupported for an asynchronous Standard Schema validator", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const codec = persistCodec(standard((value) => Promise.resolve({ value })));
    assert.strictEqual(tagOf(codec.decode(1)), "Unsupported");
    warn.mockRestore();
  });
});

describe("infiniteCodec", () => {
  const codec = infiniteCodec(
    persistCodec(Schema.Struct({ items: Schema.Array(Schema.Number) })),
    persistCodec(Schema.Number),
  );

  it("round-trips pages and page params", () => {
    const data = { pages: [{ items: [1] }, { items: [2] }], pageParams: [0, 1] };
    const encoded = codec.encode(data);
    assert.isTrue(Result.isSuccess(encoded));
    assert.deepStrictEqual(codec.decode(Result.getOrThrow(encoded)), Result.succeed(data));
  });

  it.each([
    ["not an object", 1],
    ["missing pages", { pageParams: [] }],
    ["mismatched lengths", { pages: [{ items: [] }], pageParams: [] }],
  ])("returns Invalid for %s", (_, json) => {
    assert.strictEqual(tagOf(codec.decode(json)), "Invalid");
  });

  it("fails as a whole when one page is invalid", () => {
    assert.strictEqual(
      tagOf(codec.decode({ pages: [{ items: [1] }, { items: ["x"] }], pageParams: [0, 1] })),
      "Invalid",
    );
  });
});
