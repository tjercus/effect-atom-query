/**
 * Showing failures. The error type is a closed union, so `describeError` is
 * exhaustive: add a new error to the API and this stops compiling until the
 * UI handles it.
 */
import type { QueryResult } from "@effect-atom-query/react";
import { Option } from "effect";
import type { FlightApiError } from "../api/domain.ts";
import { isRetryable, MAX_RETRIES } from "../queries.ts";

export interface ErrorDescription {
  readonly title: string;
  readonly hint: string;
}

export const describeError = (error: FlightApiError): ErrorDescription => {
  switch (error._tag) {
    case "RateLimited":
      return {
        title: "Rate limited",
        hint: `The server asked to wait ${error.retryAfterMs / 1000} s; the retry schedule waits at least that long.`,
      };
    case "UpstreamUnavailable":
      return {
        title: error.status === 0 ? "Network unreachable" : `Upstream returned ${error.status}`,
        hint: "Transient, so it is retried with exponential backoff and jitter.",
      };
    case "FlightNotFound":
      return {
        title: `No flight ${error.flightNo}`,
        hint: "Not retried: retrying cannot fix a 404.",
      };
    case "BadResponse":
      return {
        title: "Unexpected response",
        hint: `The response did not match the schema: ${error.reason}`,
      };
  }
};

/** A failed result's typed error. */
export function FailureBanner({
  result,
}: {
  readonly result: QueryResult.Failure<unknown, FlightApiError>;
}) {
  return Option.match(result.error, {
    onSome: (error) => {
      const { title, hint } = describeError(error);
      return (
        <div className={`banner ${isRetryable(error) ? "warn" : "error"}`} role="alert">
          <strong>
            <code>{error._tag}</code> · {title}
          </strong>
          <span>{hint}</span>
        </div>
      );
    },
    // A defect has no typed error. `useQuery` throws those to an error boundary instead.
    onNone: () => null,
  });
}

/** While a fetch is retrying: which attempt, and the typed reason for the last failure. */
export function RetryIndicator({
  result,
}: {
  readonly result: QueryResult.QueryResult<unknown, FlightApiError>;
}) {
  if (!result.isFetching || result.failureCount === 0) {
    return null;
  }
  return (
    <div className="retry" role="status">
      Retry {result.failureCount} of {MAX_RETRIES}
      {Option.match(result.failureReason, {
        onNone: () => null,
        onSome: (error) => (
          <>
            {" "}
            after <code>{error._tag}</code>
          </>
        ),
      })}
      …
    </div>
  );
}

export function FetchDot({ active }: { readonly active: boolean }) {
  return <span className={`dot ${active ? "on" : ""}`} aria-hidden />;
}
