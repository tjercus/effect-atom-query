import { Schema } from "effect";
import type { PersistCodec } from "./queryEntry.ts";

/**
 * A [Standard Schema v1](https://standardschema.dev) validator producing `A`,
 * as zod, Valibot and ArkType schemas are. Declared here rather than imported,
 * as the spec recommends.
 */
export interface StandardSchema<A> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => StandardSchemaResult<A> | PromiseLike<StandardSchemaResult<A>>;
    readonly types?: { readonly input: unknown; readonly output: A } | undefined;
  };
}

/** The result of a Standard Schema validation. */
export type StandardSchemaResult<A> =
  | { readonly value: A; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<{ readonly message: string }> };

/** An Effect Schema codec, or a Standard Schema validator for JSON-compatible data. */
export type PersistSchema<A> = Schema.Codec<A, any> | StandardSchema<A>;

const cache = new WeakMap<object, PersistCodec<any>>();

const effectCodec = <A>(schema: Schema.Codec<A, any>): PersistCodec<A> => {
  const json = Schema.toCodecJson(schema);
  return {
    encode: Schema.encodeSync(json),
    decode: Schema.decodeUnknownSync(json),
  } as PersistCodec<A>;
};

const isPromiseLike = (u: unknown): u is PromiseLike<unknown> =>
  typeof u === "object" && u !== null && typeof (u as PromiseLike<unknown>).then === "function";

/**
 * Standard Schema validates but does not encode: the data is stored as is
 * (it must be JSON-compatible) and validated when restored. Restoring is
 * synchronous, so an asynchronous validator cannot be used.
 */
const standardCodec = <A>(schema: StandardSchema<A>): PersistCodec<A> => {
  let warned = false;
  return {
    encode: (data) => data,
    decode: (json) => {
      const result = schema["~standard"].validate(json);
      if (isPromiseLike(result)) {
        if (!warned) {
          warned = true;
          console.warn(
            `effect-atom-query: persisted data was not restored, because the persist schema's ` +
              `validator (${schema["~standard"].vendor}) is asynchronous. Restoring needs a ` +
              `synchronous validator: avoid async refinements in persisted schemas.`,
          );
        }
        throw new Error("Asynchronous Standard Schema validators are not supported");
      }
      if (result.issues !== undefined) {
        throw new Error(
          `Persisted data is invalid: ${result.issues.map((i) => i.message).join("; ")}`,
        );
      }
      return result.value;
    },
  };
};

/**
 * A synchronous JSON codec for persisted data (memoised per schema). An Effect
 * Schema is used through its JSON codec, even if it also carries `~standard`,
 * so non-JSON values (`DateTime`, `Option`) round-trip. @internal
 */
export const persistCodec = <A>(schema: PersistSchema<A>): PersistCodec<A> => {
  let codec = cache.get(schema);
  if (codec === undefined) {
    codec = Schema.isSchema(schema)
      ? effectCodec(schema as Schema.Codec<A, any>)
      : standardCodec(schema as StandardSchema<A>);
    cache.set(schema, codec);
  }
  return codec;
};

/** The codec of infinite query data, from codecs for pages and page params. @internal */
export const infiniteCodec = <Page, Param>(
  page: PersistCodec<Page>,
  pageParam: PersistCodec<Param>,
): PersistCodec<{
  readonly pages: ReadonlyArray<Page>;
  readonly pageParams: ReadonlyArray<Param>;
}> => ({
  encode: (data) => ({
    pages: data.pages.map(page.encode),
    pageParams: data.pageParams.map(pageParam.encode),
  }),
  decode: (json) => {
    const value = json as { readonly pages?: unknown; readonly pageParams?: unknown } | null;
    if (
      typeof value !== "object" ||
      value === null ||
      !Array.isArray(value.pages) ||
      !Array.isArray(value.pageParams) ||
      value.pages.length !== value.pageParams.length
    ) {
      throw new Error("Persisted infinite query data is invalid");
    }
    return {
      pages: value.pages.map(page.decode),
      pageParams: value.pageParams.map(pageParam.decode),
    };
  },
});
