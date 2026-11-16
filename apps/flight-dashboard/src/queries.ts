/**
 * Queries are defined once, at module level. `run` is an Effect that needs a
 * `FlightApi`; the runtime decides which one. Retries are a `Schedule`.
 */
import { Query, type QueryResult } from "@effect-atom-query/react";
import { Duration, Effect, Option, Schedule } from "effect";
import type { Airport, FlightApiError } from "./api/domain.ts";
import { FlightApi } from "./api/FlightApi.ts";

/** Only transient errors are worth another attempt. */
export const isRetryable = (error: FlightApiError): boolean =>
  error._tag === "RateLimited" || error._tag === "UpstreamUnavailable";

/** Retries after the first attempt, at most. */
export const MAX_RETRIES = 4;

/**
 * The retry policy, as one value:
 * - exponential backoff from 300 ms, with jitter,
 * - but never sooner than a `RateLimited` error's `retryAfterMs`,
 * - at most {@link MAX_RETRIES} retries,
 * - and none at all for errors that retrying cannot fix.
 *
 * The schedule's input is the typed error, so every step can look at it.
 */
export const flightRetry = Schedule.exponential("300 millis").pipe(
  Schedule.jittered,
  Schedule.setInputType<FlightApiError>(),
  Schedule.modifyDelay(({ input, duration }) =>
    Effect.succeed(
      input._tag === "RateLimited"
        ? Duration.max(duration, Duration.millis(input.retryAfterMs))
        : duration,
    ),
  ),
  Schedule.upTo({ times: MAX_RETRIES }),
  Schedule.while(({ input }) => isRetryable(input)),
);

/**
 * A `refetchInterval` that polls every `interval`, but stops once the query
 * fails with an error that polling cannot fix (a 404, a bad response).
 */
export const pollUnlessPermanent =
  (interval: Duration.Input) =>
  (result: QueryResult.QueryResult<unknown, FlightApiError>): Duration.Input | false =>
    result.isError && Option.exists(result.error, (error) => !isRetryable(error))
      ? false
      : interval;

export const departuresQuery = Query.make({
  key: (airport: Airport) => ["departures", airport],
  run: (airport) => FlightApi.use((api) => api.departures(airport)),
  retry: flightRetry,
});

export const flightQuery = Query.make({
  key: (flightNo: string) => ["flight", flightNo.toUpperCase()],
  run: (flightNo) => FlightApi.use((api) => api.flight(flightNo)),
  retry: flightRetry,
});

export const searchQuery = Query.make({
  key: (term: string) => ["search", term.trim().toUpperCase()],
  run: (term) => FlightApi.use((api) => api.search(term)),
  retry: flightRetry,
  staleTime: "30 seconds",
});
