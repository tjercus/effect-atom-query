/**
 * The HTTP layer against a stubbed `fetch`: status codes become typed errors,
 * and interrupting a request aborts it.
 */
import { it } from "@effect/vitest";
import { QueryClient } from "@effect-atom-query/react";
import { Deferred, Effect, Exit, Fiber, Option } from "effect";
import { FetchHttpClient } from "effect/http";
import { describe, expect } from "vite-plus/test";
import {
  BadResponse,
  FlightNotFound,
  RateLimited,
  UpstreamUnavailable,
} from "../src/api/domain.ts";
import { FlightApi } from "../src/api/FlightApi.ts";
import { layerHttp } from "../src/api/layers.ts";
import { departuresAt } from "../src/api/flightData.ts";
import { makeRuntime } from "../src/runtime.ts";

const http = layerHttp("http://flights.test/api");

const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
      }),
    )) as unknown as typeof fetch;

/** Calls the API with `fetch` replaced. */
const withFetch = <A, E>(
  stub: typeof fetch,
  f: (api: FlightApi["Service"]) => Effect.Effect<A, E>,
) =>
  FlightApi.use(f).pipe(
    Effect.exit,
    Effect.provideService(FetchHttpClient.Fetch, stub),
    Effect.provide(http),
  );

describe("layerHttp", () => {
  it("builds synchronously, as QueryClientProvider requires", async () => {
    const runtime = makeRuntime({ backend: "http", chaos: true });
    expect(runtime.runSync(QueryClient.QueryClient)).toBeDefined();
    await runtime.dispose();
  });

  it.effect("decodes a 200", () =>
    Effect.gen(function* () {
      const board = departuresAt("AMS", 0);
      const exit = yield* withFetch(respond(200, board), (api) => api.departures("AMS"));
      expect(exit).toStrictEqual(Exit.succeed(board));
    }),
  );

  it.effect("maps 404 to FlightNotFound", () =>
    Effect.gen(function* () {
      const exit = yield* withFetch(respond(404, {}), (api) => api.flight("XX999"));
      expect(exit).toStrictEqual(Exit.fail(new FlightNotFound({ flightNo: "XX999" })));
    }),
  );

  it.effect("maps 429 to RateLimited, with Retry-After", () =>
    Effect.gen(function* () {
      const exit = yield* withFetch(respond(429, {}, { "retry-after": "3" }), (api) =>
        api.departures("AMS"),
      );
      expect(exit).toStrictEqual(Exit.fail(new RateLimited({ retryAfterMs: 3000 })));
    }),
  );

  it.effect("maps 5xx to UpstreamUnavailable", () =>
    Effect.gen(function* () {
      const exit = yield* withFetch(respond(502, {}), (api) => api.departures("AMS"));
      expect(exit).toStrictEqual(Exit.fail(new UpstreamUnavailable({ status: 502 })));
    }),
  );

  it.effect("maps a network failure to UpstreamUnavailable with status 0", () =>
    Effect.gen(function* () {
      const offline = (() =>
        Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch;
      const exit = yield* withFetch(offline, (api) => api.departures("AMS"));
      expect(exit).toStrictEqual(Exit.fail(new UpstreamUnavailable({ status: 0 })));
    }),
  );

  it.effect("maps another non-2xx status to BadResponse, without decoding the body", () =>
    Effect.gen(function* () {
      const exit = yield* withFetch(respond(403, []), (api) => api.departures("AMS"));
      expect(exit).toStrictEqual(Exit.fail(new BadResponse({ reason: "Unexpected status 403" })));
    }),
  );

  it.effect("maps a response of the wrong shape to BadResponse", () =>
    Effect.gen(function* () {
      const exit = yield* withFetch(respond(200, [{ flightNo: 1 }]), (api) =>
        api.departures("AMS"),
      );
      const tag = Option.map(Exit.findErrorOption(exit), (error) => error._tag);
      expect(tag).toStrictEqual(Option.some("BadResponse"));
    }),
  );

  it.effect("aborts the request when its fiber is interrupted", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<AbortSignal>();
      const hanging = ((_: RequestInfo, init?: RequestInit) => {
        Deferred.doneUnsafe(started, Exit.succeed(init!.signal!));
        return new Promise<Response>(() => {});
      }) as unknown as typeof fetch;

      const fiber = yield* Effect.forkChild(withFetch(hanging, (api) => api.search("KL")));
      const signal = yield* Deferred.await(started);
      expect(signal.aborted).toBe(false);
      yield* Fiber.interrupt(fiber);
      expect(signal.aborted).toBe(true);
    }),
  );
});
