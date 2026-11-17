/**
 * Every implementation of `FlightApi`, as layers. The app picks one at
 * runtime; the tests use the same ones. Components and queries never know
 * which one serves them.
 *
 * - `layerHttp`: real HTTP (`fetch`) against the dev server's `/api`. Interrupting
 *   a query's fiber aborts the request, which shows in the browser's Network tab.
 * - `layerInMemory`: the same data, computed in the browser.
 * - `layerChaos`: a decorator. It requires a `FlightApi` and provides a worse one.
 * - `layerRequestLog`: a decorator that records how each request ended.
 */
import { Clock, Duration, Effect, Exit, Layer, Option, Schema } from "effect";
import { FetchHttpClient, HttpClient, type HttpClientResponse } from "effect/http";
import {
  type Airport,
  BadResponse,
  Flight,
  FlightDetail,
  FlightNotFound,
  RateLimited,
  type TransientError,
  UpstreamUnavailable,
} from "./domain.ts";
import { FlightApi } from "./FlightApi.ts";
import { departuresAt, flightAt, searchAt } from "./flightData.ts";

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const Flights = Schema.Array(Flight);

/** Maps a response to the domain: 2xx is decoded, everything else is a typed error. */
const decode =
  <A>(schema: Schema.Codec<A, unknown>) =>
  (
    response: HttpClientResponse.HttpClientResponse,
  ): Effect.Effect<A, TransientError | BadResponse> => {
    if (response.status === 429) {
      const seconds = Number(response.headers["retry-after"] ?? "1");
      return Effect.fail(new RateLimited({ retryAfterMs: seconds * 1000 }));
    }
    if (response.status >= 500) {
      return Effect.fail(new UpstreamUnavailable({ status: response.status }));
    }
    if (response.status < 200 || response.status >= 300) {
      // Not transient, and the body is not what the schema describes.
      return Effect.fail(new BadResponse({ reason: `Unexpected status ${response.status}` }));
    }
    return response.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(schema)),
      Effect.mapError((error) => new BadResponse({ reason: error.message })),
    );
  };

export const layerHttp = (baseUrl = "/api"): Layer.Layer<FlightApi> =>
  Layer.effect(
    FlightApi,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      /** GET, with transport failures (offline, DNS, CORS) as `UpstreamUnavailable`. */
      const get = (path: string) =>
        http
          .get(`${baseUrl}${path}`)
          .pipe(
            Effect.catchTag("HttpClientError", () =>
              Effect.fail(new UpstreamUnavailable({ status: 0 })),
            ),
          );

      return FlightApi.of({
        departures: (airport) =>
          get(`/departures/${airport}`).pipe(Effect.flatMap(decode(Flights))),
        flight: (flightNo) =>
          get(`/flights/${encodeURIComponent(flightNo)}`).pipe(
            Effect.flatMap(
              (
                response,
              ): Effect.Effect<FlightDetail, TransientError | FlightNotFound | BadResponse> =>
                response.status === 404
                  ? Effect.fail(new FlightNotFound({ flightNo }))
                  : decode(FlightDetail)(response),
            ),
          ),
        search: (term) =>
          get(`/search?q=${encodeURIComponent(term)}`).pipe(Effect.flatMap(decode(Flights))),
      });
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));

// ---------------------------------------------------------------------------
// in memory
// ---------------------------------------------------------------------------

export interface InMemoryOptions {
  /** Simulated latency per request. Search takes three times as long. Default 200 ms. */
  readonly latency?: Duration.Input | undefined;
}

export const layerInMemory = (options?: InMemoryOptions): Layer.Layer<FlightApi> =>
  Layer.sync(FlightApi, () => {
    const latency = Duration.fromInputUnsafe(options?.latency ?? "200 millis");
    /** Waits, then computes the answer at the (possibly test) clock's time. */
    const respond = <A>(times: number, f: (now: number) => A) =>
      Effect.sleep(Duration.times(latency, times)).pipe(
        Effect.andThen(Clock.currentTimeMillis),
        Effect.map(f),
      );
    return FlightApi.of({
      departures: (airport: Airport) => respond(1, (now) => departuresAt(airport, now)),
      flight: (flightNo) =>
        respond(1, (now) => flightAt(flightNo, now)).pipe(
          Effect.flatMap((flight) =>
            flight === undefined
              ? Effect.fail(new FlightNotFound({ flightNo }))
              : Effect.succeed(flight),
          ),
        ),
      search: (term) => respond(3, (now) => searchAt(term, now)),
    });
  });

// ---------------------------------------------------------------------------
// chaos
// ---------------------------------------------------------------------------

export interface ChaosSettings {
  /** Chance (0–1) that a request fails with a transient error. */
  readonly failureRate: number;
  /** Extra latency added to every request, in milliseconds. */
  readonly extraLatencyMs: number;
  /** Chance (0–1) that a request dies with a defect (a bug, not a typed error). */
  readonly defectRate: number;
}

export const calmChaos: ChaosSettings = { failureRate: 0, extraLatencyMs: 0, defectRate: 0 };

export interface ChaosOptions {
  /** Read on every request, so the settings can change without rebuilding the layer. */
  readonly settings: () => ChaosSettings;
  /** A number in [0, 1). Inject a fixed one in tests. Default `Math.random`. */
  readonly random?: (() => number) | undefined;
}

/**
 * Wraps the `FlightApi` below it: more latency, transient failures, and the
 * occasional defect. Every error it adds is already in each method's error
 * type, so the decorated service has the same interface.
 */
export const layerChaos = (options: ChaosOptions): Layer.Layer<FlightApi, never, FlightApi> =>
  Layer.effect(
    FlightApi,
    Effect.gen(function* () {
      const inner = yield* FlightApi;
      const random = options.random ?? Math.random;

      const chaos = <A, E>(request: Effect.Effect<A, E>): Effect.Effect<A, E | TransientError> =>
        Effect.suspend(() => {
          const { failureRate, extraLatencyMs, defectRate } = options.settings();
          const roll = random();
          const outcome: Effect.Effect<A, E | TransientError> =
            roll < defectRate
              ? Effect.die(new Error("Chaos: the flight API crashed (a defect, not a typed error)"))
              : roll < defectRate + failureRate / 2
                ? Effect.fail(new RateLimited({ retryAfterMs: 1500 }))
                : roll < defectRate + failureRate
                  ? Effect.fail(new UpstreamUnavailable({ status: 503 }))
                  : request;
          return extraLatencyMs > 0
            ? Effect.andThen(Effect.sleep(Duration.millis(extraLatencyMs)), outcome)
            : outcome;
        });

      return FlightApi.of({
        departures: (airport) => chaos(inner.departures(airport)),
        flight: (flightNo) => chaos(inner.flight(flightNo)),
        search: (term) => chaos(inner.search(term)),
      });
    }),
  );

// ---------------------------------------------------------------------------
// request log
// ---------------------------------------------------------------------------

export type RequestOutcome =
  | { readonly _tag: "Ok" }
  | { readonly _tag: "Failed"; readonly error: string }
  | { readonly _tag: "Defect" }
  | { readonly _tag: "Cancelled" };

export interface RequestLogEntry {
  readonly id: number;
  readonly request: string;
  readonly startedAt: number;
  readonly millis: number;
  readonly outcome: RequestOutcome;
}

/**
 * Records how every request ended. Cancellation is fiber interruption, so a
 * cancelled query shows up here as `Cancelled`: the request's own fiber was
 * interrupted, not just its result ignored.
 */
export const layerRequestLog = (
  record: (entry: RequestLogEntry) => void,
): Layer.Layer<FlightApi, never, FlightApi> =>
  Layer.effect(
    FlightApi,
    Effect.gen(function* () {
      const inner = yield* FlightApi;
      let nextId = 1;

      const logged =
        (request: string) =>
        <A, E extends { readonly _tag: string }>(
          effect: Effect.Effect<A, E>,
        ): Effect.Effect<A, E> =>
          Effect.gen(function* () {
            const id = nextId++;
            const startedAt = yield* Clock.currentTimeMillis;
            return yield* effect.pipe(
              Effect.onExit((exit) =>
                Effect.map(Clock.currentTimeMillis, (endedAt) => {
                  const outcome: RequestOutcome = Exit.isSuccess(exit)
                    ? { _tag: "Ok" }
                    : Exit.hasInterrupts(exit)
                      ? { _tag: "Cancelled" }
                      : Option.match(Exit.findErrorOption(exit), {
                          onNone: () => ({ _tag: "Defect" }) as const,
                          onSome: (error) => ({ _tag: "Failed", error: error._tag }) as const,
                        });
                  record({ id, request, startedAt, millis: endedAt - startedAt, outcome });
                }),
              ),
            );
          });

      return FlightApi.of({
        departures: (airport) => logged(`departures ${airport}`)(inner.departures(airport)),
        flight: (flightNo) => logged(`flight ${flightNo}`)(inner.flight(flightNo)),
        search: (term) => logged(`search "${term}"`)(inner.search(term)),
      });
    }),
  );
