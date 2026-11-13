/**
 * Query keys identify cache entries.
 *
 * A key is a readonly tuple whose first element is a string namespace. Keys use
 * Effect's structural `Equal` / `Hash`, so `["todos", { page: 1 }]` built twice
 * points at the same cache entry, and object property order does not matter.
 *
 * @since 0.1.0
 */
import { Equal, Predicate } from "effect";

/**
 * @since 0.1.0
 * @category models
 */
export type QueryKey = readonly [string, ...ReadonlyArray<unknown>];

declare const DataTypeId: unique symbol;

/**
 * A query key that remembers the data and error types of the query it belongs
 * to, so `QueryClient.getQueryData(key)` can return a typed `Option<A>`.
 *
 * The brand exists only at the type level.
 *
 * @since 0.1.0
 * @category models
 */
export type Tagged<A, E = never> = QueryKey & {
  readonly [DataTypeId]?: { readonly data: A; readonly error: E };
};

/**
 * Extracts the data type carried by a {@link Tagged} key.
 *
 * @since 0.1.0
 * @category type-level
 */
export type DataOf<K> = K extends Tagged<infer A, any> ? A : unknown;

/**
 * Extracts the error type carried by a {@link Tagged} key.
 *
 * @since 0.1.0
 * @category type-level
 */
export type ErrorOf<K> = K extends Tagged<any, infer E> ? E : unknown;

/**
 * Brands a key with data and error types.
 *
 * @since 0.1.0
 * @category constructors
 */
export const tagged = <A, E = never>(key: QueryKey): Tagged<A, E> => key as Tagged<A, E>;

/**
 * Structural equality of two keys.
 *
 * @since 0.1.0
 * @category predicates
 */
export const equals = (self: QueryKey, that: QueryKey): boolean => Equal.equals(self, that);

/**
 * Partial (prefix) matching, as TanStack Query defines it.
 *
 * `partial` matches `key` when every element or property present in `partial`
 * matches the same position in `key`, recursively. So `["todos"]` matches
 * `["todos", 1]`, and `["todos", { done: true }]` matches
 * `["todos", { done: true, page: 2 }]`. Leaves are compared with `Equal.equals`.
 *
 * @since 0.1.0
 * @category predicates
 */
export const matches = (key: QueryKey, partial: QueryKey): boolean => partialMatch(key, partial);

const isPlainContainer = (u: unknown): u is Record<PropertyKey, unknown> =>
  Array.isArray(u) ||
  (Predicate.isObject(u) &&
    (Object.getPrototypeOf(u) === Object.prototype || Object.getPrototypeOf(u) === null));

const partialMatch = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (isPlainContainer(a) && isPlainContainer(b)) {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    for (const k of Object.keys(b)) {
      if (!partialMatch(a[k], b[k])) return false;
    }
    return true;
  }
  return Equal.equals(a, b);
};
