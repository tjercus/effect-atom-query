/**
 * Port of TanStack Query's `replaceEqualDeep`: returns `a` when `b` is deeply
 * equal, otherwise a copy of `b` that reuses every unchanged subtree of `a`.
 * Only plain objects and arrays are traversed; anything else is taken from `b`.
 * @internal
 */
export const replaceEqualDeep = <T>(a: unknown, b: T): T => {
  if (a === b) {
    return a as T;
  }
  const array = isPlainArray(a) && isPlainArray(b);
  if (!array && !(isPlainObject(a) && isPlainObject(b))) {
    return b;
  }

  const prev = a as Record<PropertyKey, unknown>;
  const next = b as Record<PropertyKey, unknown>;
  const aItems: ReadonlyArray<PropertyKey> = array
    ? (a as Array<unknown>).map((_, i) => i)
    : Object.keys(prev);
  const bItems: ReadonlyArray<PropertyKey> = array
    ? (b as Array<unknown>).map((_, i) => i)
    : Object.keys(next);
  const aKeys = new Set(aItems);
  const copy = (array ? [] : {}) as Record<PropertyKey, unknown>;
  let equalItems = 0;

  for (const key of bItems) {
    if (aKeys.has(key) && prev[key] === undefined && next[key] === undefined) {
      copy[key] = undefined;
      equalItems++;
    } else {
      copy[key] = replaceEqualDeep(prev[key], next[key]);
      if (copy[key] === prev[key] && prev[key] !== undefined) {
        equalItems++;
      }
    }
  }
  return (aItems.length === bItems.length && equalItems === aItems.length ? a : copy) as T;
};

const isPlainArray = (u: unknown): u is Array<unknown> =>
  Array.isArray(u) && u.length === Object.keys(u).length;

const isPlainObject = (u: unknown): u is Record<PropertyKey, unknown> => {
  if (Object.prototype.toString.call(u) !== "[object Object]") {
    return false;
  }
  const proto = Object.getPrototypeOf(u);
  return proto === null || proto === Object.prototype;
};
