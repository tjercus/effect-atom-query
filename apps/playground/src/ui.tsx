import type { QueryResult } from "@effect-atom-query/react";
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

/** Shown under data that stays on screen after a refetch failed. */
export const StaleDataError = ({
  failure,
}: {
  readonly failure: QueryResult.Failure<any, { readonly message: string }>;
}) => (
  <p style={{ color: "#dc2626" }}>Error: {errorMessage(failure)} (showing the last loaded data)</p>
);

export const Status = ({ result }: { readonly result: QueryResult.QueryResult<any, any> }) => (
  <small style={{ color: "#64748b" }}>
    {result.status} · {result.fetchStatus}
    {result.isStale ? " · stale" : ""}
  </small>
);
