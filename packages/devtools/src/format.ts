/** Value formatting for the devtools explorer. */
import type { QueryInspector } from "@effect-atom-query/query";

const MAX_LENGTH = 50_000;

/**
 * A JSON-safe copy of any value: Effect data uses its `toJSON`, and bigints,
 * Maps, Sets, functions and cycles get readable placeholders. Only real
 * cycles (an ancestor referenced again) are marked; shared references are
 * printed in full.
 */
const toJsonSafe = (value: unknown, ancestors: Set<object>, depth: number): unknown => {
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (typeof value === "symbol") return value.toString();
  if (value === undefined) return "[undefined]";
  if (typeof value !== "object" || value === null) return value;
  if (ancestors.has(value)) return "[Circular]";
  if (depth > 50) return "[…]";
  ancestors.add(value);
  try {
    const next = (v: unknown) => toJsonSafe(v, ancestors, depth + 1);
    if (value instanceof Map) {
      return { _id: "Map", entries: Array.from(value.entries(), ([k, v]) => [next(k), next(v)]) };
    }
    if (value instanceof Set) return { _id: "Set", values: Array.from(value.values(), next) };
    if (Array.isArray(value)) return value.map(next);
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === "function") {
      const json: unknown = toJSON.call(value);
      return json === value ? "[object]" : next(json);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = next(v);
    return out;
  } finally {
    ancestors.delete(value);
  }
};

const truncate = (text: string): string =>
  text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH)}\n… (truncated)` : text;

/** Pretty JSON for any value; never throws. */
export const formatValue = (value: unknown): string => {
  try {
    return truncate(JSON.stringify(toJsonSafe(value, new Set(), 0), null, 2) ?? String(value));
  } catch (error) {
    return `[unserialisable: ${error instanceof Error ? error.message : String(error)}]`;
  }
};

/** Compact one-line form of a key; never throws. */
export const formatKey = (key: ReadonlyArray<unknown>): string => {
  try {
    return JSON.stringify(toJsonSafe(key, new Set(), 0));
  } catch {
    return String(key);
  }
};

/** "3s ago", "2m ago", … */
export const formatAgo = (epochMillis: number, now: number): string => {
  const seconds = Math.max(0, Math.round((now - epochMillis) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
};

export const formatDuration = (millis: number | "static"): string => {
  if (millis === "static") return "static";
  if (!Number.isFinite(millis)) return "Infinity";
  if (millis < 1000) return `${millis}ms`;
  if (millis < 60_000) return `${millis / 1000}s`;
  return `${Math.round(millis / 6000) / 10}m`;
};

/** TanStack's devtools status label for a query. */
export type QueryLabel = "fetching" | "paused" | "error" | "stale" | "inactive" | "fresh";

export const queryLabel = (q: QueryInspector.QuerySnapshot): QueryLabel => {
  if (q.fetchStatus === "fetching") return "fetching";
  if (q.fetchStatus === "paused") return "paused";
  if (q.status === "error") return "error";
  if (q.observers === 0) return "inactive";
  if (q.isStale) return "stale";
  return "fresh";
};
