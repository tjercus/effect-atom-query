/** Value formatting for the devtools explorer. */
import type { QueryInspector } from "@effect-atom-query/query";

const MAX_LENGTH = 50_000;

/**
 * Pretty JSON for any value: Effect data uses its `toJSON`, and bigints, Maps,
 * Sets, functions and cycles get readable placeholders.
 */
export const formatValue = (value: unknown): string => {
  const seen = new WeakSet<object>();
  let text: string;
  try {
    text =
      JSON.stringify(
        value,
        function (_key, v: unknown) {
          if (typeof v === "bigint") return `${v}n`;
          if (typeof v === "function") return `[Function ${v.name || "anonymous"}]`;
          if (typeof v === "symbol") return v.toString();
          if (v === undefined) return "[undefined]";
          if (v instanceof Map) return { _id: "Map", entries: Array.from(v.entries()) };
          if (v instanceof Set) return { _id: "Set", values: Array.from(v.values()) };
          if (typeof v === "object" && v !== null) {
            if (seen.has(v)) return "[Circular]";
            seen.add(v);
          }
          return v;
        },
        2,
      ) ?? String(value);
  } catch (error) {
    text = `[unserialisable: ${error instanceof Error ? error.message : String(error)}]`;
  }
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH)}\n… (truncated)` : text;
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
