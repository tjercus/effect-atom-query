/**
 * The flight domain: data shapes as Schemas (so the HTTP backend can decode
 * responses) and every way a request can fail, as tagged errors.
 */
import { Schema } from "effect";

export const airports = ["AMS", "LHR", "JFK", "SFO"] as const;
export type Airport = (typeof airports)[number];

export const FlightStatus = Schema.Literals([
  "Scheduled",
  "Boarding",
  "Delayed",
  "Departed",
  "Cancelled",
]);
export type FlightStatus = typeof FlightStatus.Type;

export const Flight = Schema.Struct({
  flightNo: Schema.String,
  airline: Schema.String,
  from: Schema.String,
  to: Schema.String,
  /** Scheduled departure, "HH:MM". */
  scheduled: Schema.String,
  gate: Schema.String,
  status: FlightStatus,
  delayMinutes: Schema.Number,
});
export type Flight = typeof Flight.Type;

export const FlightDetail = Schema.Struct({
  ...Flight.fields,
  aircraft: Schema.String,
  /** Live position, refreshed by the backend. */
  altitudeFt: Schema.Number,
  speedKts: Schema.Number,
  updatedAt: Schema.String,
});
export type FlightDetail = typeof FlightDetail.Type;

// ---------------------------------------------------------------------------
// errors: each one gets its own UI, and the retry policy treats them differently
// ---------------------------------------------------------------------------

/** HTTP 429. Retried, no sooner than `retryAfterMs`. */
export class RateLimited extends Schema.TaggedError<RateLimited>()("RateLimited", {
  retryAfterMs: Schema.Number,
}) {}

/** HTTP 5xx, or the network is down (`status: 0`). Retried with backoff. */
export class UpstreamUnavailable extends Schema.TaggedError<UpstreamUnavailable>()(
  "UpstreamUnavailable",
  { status: Schema.Number },
) {}

/** HTTP 404. Retrying cannot help, so it is never retried. */
export class FlightNotFound extends Schema.TaggedError<FlightNotFound>()("FlightNotFound", {
  flightNo: Schema.String,
}) {}

/** The response did not match the schema. Never retried. */
export class BadResponse extends Schema.TaggedError<BadResponse>()("BadResponse", {
  reason: Schema.String,
}) {}

/** What any request can fail with, whichever backend serves it. */
export type TransientError = RateLimited | UpstreamUnavailable;
export type FlightApiError = TransientError | FlightNotFound | BadResponse;
