import { describe, expect, it } from "@effect/vitest";
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
    expect(tagOf(codec.decode({ n: "x" }))).toBe("Invalid");
    expect(codec.decode({ n: 1 })).toEqual(Result.succeed({ n: 1 }));
  });

  it("returns Invalid for data a Standard Schema rejects", () => {
    const codec = persistCodec(standard(() => ({ issues: [{ message: "nope" }] })));
    const r = codec.decode(1);
    expect(tagOf(r)).toBe("Invalid");
    expect(Result.isFailure(r) && r.failure._tag === "Invalid" && r.failure.message).toContain(
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
    expect(tagOf(codec.decode("a"))).toBe("Defect");
    expect(tagOf(codec.decode("b"))).toBe("Defect");
    expect(tagOf(codec.encode("c"))).toBe("Defect");
    // Once per direction: decoding and encoding are reported separately.
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("returns Defect when a Standard Schema validator throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const codec = persistCodec(
      standard(() => {
        throw new Error("boom");
      }),
    );
    expect(tagOf(codec.decode(1))).toBe("Defect");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("returns Unsupported for an asynchronous Standard Schema validator", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const codec = persistCodec(standard((value) => Promise.resolve({ value })));
    expect(tagOf(codec.decode(1))).toBe("Unsupported");
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
    expect(Result.isSuccess(encoded)).toBe(true);
    expect(codec.decode(Result.getOrThrow(encoded))).toEqual(Result.succeed(data));
  });

  it.each([
    ["not an object", 1],
    ["missing pages", { pageParams: [] }],
    ["mismatched lengths", { pages: [{ items: [] }], pageParams: [] }],
  ])("returns Invalid for %s", (_, json) => {
    expect(tagOf(codec.decode(json))).toBe("Invalid");
  });

  it("fails as a whole when one page is invalid", () => {
    expect(
      tagOf(codec.decode({ pages: [{ items: [1] }, { items: ["x"] }], pageParams: [0, 1] })),
    ).toBe("Invalid");
  });
});
