import { Result } from "effect";
import * as QueryKey from "../QueryKey.ts";

/**
 * `QueryKey.toJsonKey` as a value: `JSON.stringify` throws on keys JSON cannot
 * hold (cycles, a throwing `toJSON`). @internal
 */
export const jsonKey = (key: ReadonlyArray<unknown>): Result.Result<string, unknown> =>
  Result.try(() => QueryKey.toJsonKey(key));

/**
 * A readable form of a key for labels and messages: its JSON key, or a
 * best-effort rendering when it has none. Never throws. @internal
 */
export const keyLabel = (key: ReadonlyArray<unknown>): string =>
  Result.getOrElse(
    jsonKey(key),
    () =>
      `[${key.map((part) => (typeof part === "bigint" ? `${part}n` : String(part))).join(",")}]`,
  );
