import type { QueryResult } from "@effect-native-query/react";
import { Cause, Option } from "effect";
import type { ReactNode } from "react";

export interface Example {
  readonly id: string;
  readonly title: string;
  /** The TanStack Query example this mirrors. */
  readonly tanstack: string;
  readonly description: ReactNode;
  readonly Component: () => ReactNode;
}

/** The message of a failed result: the typed error, or the defect. */
export const errorMessage = (
  result: QueryResult.Failure<any, { readonly message: string }>,
): string =>
  Option.match(result.error, {
    onNone: () => Cause.pretty(result.cause),
    onSome: (e) => e.message,
  });

export const Status = ({ result }: { readonly result: QueryResult.QueryResult<any, any> }) => (
  <small style={{ color: "#64748b" }}>
    {result.status} · {result.fetchStatus}
    {result.isStale ? " · stale" : ""}
  </small>
);
