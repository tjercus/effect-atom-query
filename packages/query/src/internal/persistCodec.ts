import { Predicate, Result, Schema } from "effect";

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

/**
 * Why a value could not be encoded or decoded. @internal
 *
 * - `Invalid`: the schema rejected the value (expected, e.g. after a schema
 *   change): the value is skipped.
 * - `Unsupported`: the schema cannot be used synchronously (an asynchronous
 *   Standard Schema validator).
 * - `Defect`: the schema threw (a bug in a transform or validator). Reported
 *   once per schema with `console.warn`, then skipped like the others.
 */
export type PersistCodecError =
  | { readonly _tag: "Invalid"; readonly message: string }
  | { readonly _tag: "Unsupported"; readonly message: string }
  | { readonly _tag: "Defect"; readonly cause: unknown };

/**
 * JSON codec of persisted data (derived from its schema). Never throws:
 * failures are returned as values. @internal
 */
export interface PersistCodec<A> {
  readonly encode: (data: A) => Result.Result<unknown, PersistCodecError>;
  readonly decode: (json: unknown) => Result.Result<A, PersistCodecError>;
}

const invalid = (message: string): Result.Result<never, PersistCodecError> =>
  Result.fail({ _tag: "Invalid", message });

/**
 * The single boundary where exceptions from user schemas become values: a
 * throwing transform or validator is a `Defect`, reported once per codec.
 */
const guard = <I, A>(
  label: string,
  f: (input: I) => Result.Result<A, PersistCodecError>,
): ((input: I) => Result.Result<A, PersistCodecError>) => {
  let warned = false;
  return (input) => {
    try {
      return f(input);
    } catch (cause) {
      if (!warned) {
        warned = true;
        console.warn(
          `effect-atom-query: a persist schema threw while ${label} persisted data; ` +
            `the value was skipped.`,
          cause,
        );
      }
      return Result.fail({ _tag: "Defect", cause });
    }
  };
};

const cache = new WeakMap<object, PersistCodec<any>>();

const effectCodec = <A>(schema: Schema.Codec<A, any>): PersistCodec<A> => {
  const json = Schema.toCodecJson(schema);
  // Schema issues are returned as `Result.fail`; defects still throw, which
  // `guard` turns into `Defect`.
  const encode = Schema.encodeResult(json);
  const decode = Schema.decodeUnknownResult(json);
  return {
    encode: guard("encoding", (data: A) =>
      Result.mapError(encode(data), (issue) => ({ _tag: "Invalid", message: String(issue) })),
    ),
    decode: guard("decoding", (input: unknown) =>
      Result.mapError(decode(input), (issue) => ({ _tag: "Invalid", message: String(issue) })),
    ),
  } as PersistCodec<A>;
};

const isJson = Schema.is(Schema.Json);

/**
 * Standard Schema validates but does not encode: the data is stored as is
 * (it must be JSON-compatible, or it is skipped) and validated when restored. Restoring is
 * synchronous, so an asynchronous validator cannot be used.
 */
const standardCodec = <A>(schema: StandardSchema<A>): PersistCodec<A> => {
  let warned = false;
  return {
    // Stored as is, so it must already be JSON (a bigint, `Date` or class
    // instance is not); otherwise the whole snapshot would fail to encode.
    encode: (data) =>
      isJson(data) ? Result.succeed(data) : invalid("Persisted data is not a JSON value"),
    decode: guard("decoding", (json: unknown): Result.Result<A, PersistCodecError> => {
      const result = schema["~standard"].validate(json);
      if (Predicate.isPromiseLike(result)) {
        if (!warned) {
          warned = true;
          console.warn(
            `effect-atom-query: persisted data was not restored, because the persist schema's ` +
              `validator (${schema["~standard"].vendor}) is asynchronous. Restoring needs a ` +
              `synchronous validator: avoid async refinements in persisted schemas.`,
          );
        }
        return Result.fail({
          _tag: "Unsupported",
          message: "Asynchronous Standard Schema validators are not supported",
        });
      }
      if (result.issues !== undefined) {
        return invalid(
          `Persisted data is invalid: ${result.issues.map((i) => i.message).join("; ")}`,
        );
      }
      return Result.succeed(result.value);
    }),
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
  encode: (data) =>
    Result.all({
      pages: Result.all(data.pages.map((p) => page.encode(p))),
      pageParams: Result.all(data.pageParams.map((p) => pageParam.encode(p))),
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
      return invalid("Persisted infinite query data is invalid");
    }
    return Result.all({
      pages: Result.all(value.pages.map((p) => page.decode(p))),
      pageParams: Result.all(value.pageParams.map((p) => pageParam.decode(p))),
    });
  },
});
