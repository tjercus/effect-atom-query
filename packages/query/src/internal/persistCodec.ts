import { Schema } from "effect";
import type { PersistCodec } from "./queryEntry.ts";

const cache = new WeakMap<object, PersistCodec<any>>();

/** A synchronous JSON codec derived from a schema (memoised per schema). @internal */
export const persistCodec = <A>(schema: Schema.Codec<A, any>): PersistCodec<A> => {
  let codec = cache.get(schema);
  if (codec === undefined) {
    const json = Schema.toCodecJson(schema);
    codec = {
      encode: Schema.encodeSync(json),
      decode: Schema.decodeUnknownSync(json),
    } as PersistCodec<A>;
    cache.set(schema, codec);
  }
  return codec;
};
