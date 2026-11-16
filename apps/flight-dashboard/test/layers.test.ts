/**
 * The layers the app swaps between, tested as services: provide one, call the
 * API, check the outcome. The chaos layer takes its randomness as a function,
 * so every outcome can be forced.
 */
import { it } from "@effect/vitest";
import { Effect, Exit, Fiber, Layer } from "effect";
import { describe, expect } from "vite-plus/test";
import { FlightNotFound, RateLimited, UpstreamUnavailable } from "../src/api/domain.ts";
import { FlightApi } from "../src/api/FlightApi.ts";
import {
  calmChaos,
  type ChaosSettings,
  layerChaos,
  layerInMemory,
  layerRequestLog,
  type RequestLogEntry,
} from "../src/api/layers.ts";

const memory = layerInMemory({ latency: 0 });

const chaos = (settings: Partial<ChaosSettings>, roll: number) =>
  layerChaos({ settings: () => ({ ...calmChaos, ...settings }), random: () => roll }).pipe(
    Layer.provide(memory),
  );

describe("layerInMemory", () => {
  it.effect("serves a departures board", () =>
    Effect.gen(function* () {
      const api = yield* FlightApi;
      const board = yield* api.departures("AMS");
      expect(board.length).toBeGreaterThan(0);
      expect(board.every((f) => f.from === "AMS")).toBe(true);
    }).pipe(Effect.provide(memory)),
  );

  it.effect("fails with FlightNotFound for an unknown flight", () =>
    Effect.gen(function* () {
      const api = yield* FlightApi;
      const exit = yield* Effect.exit(api.flight("XX999"));
      expect(exit).toStrictEqual(Exit.fail(new FlightNotFound({ flightNo: "XX999" })));
    }).pipe(Effect.provide(memory)),
  );
});

describe("layerChaos", () => {
  const departures = FlightApi.use((api) => api.departures("LHR"));

  it.effect("passes requests through when the dice say so", () =>
    Effect.gen(function* () {
      const board = yield* departures;
      expect(board.length).toBeGreaterThan(0);
    }).pipe(Effect.provide(chaos({ failureRate: 0.5 }, 0.9))),
  );

  it.effect("fails with RateLimited on a low roll", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(departures);
      expect(exit).toStrictEqual(Exit.fail(new RateLimited({ retryAfterMs: 1500 })));
    }).pipe(Effect.provide(chaos({ failureRate: 0.5 }, 0.1))),
  );

  it.effect("fails with UpstreamUnavailable on a higher roll", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(departures);
      expect(exit).toStrictEqual(Exit.fail(new UpstreamUnavailable({ status: 503 })));
    }).pipe(Effect.provide(chaos({ failureRate: 0.5 }, 0.4))),
  );

  it.effect("dies with a defect, outside the error type", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(departures);
      expect(Exit.hasDies(exit)).toBe(true);
    }).pipe(Effect.provide(chaos({ defectRate: 0.2 }, 0.1))),
  );
});

describe("layerRequestLog", () => {
  const logged = (base: Layer.Layer<FlightApi>) => {
    const entries: Array<RequestLogEntry> = [];
    const layer = layerRequestLog((e) => entries.push(e)).pipe(Layer.provide(base));
    return { entries, layer };
  };

  it.effect("records successes and typed failures", () => {
    const { entries, layer } = logged(memory);
    return Effect.gen(function* () {
      const api = yield* FlightApi;
      yield* api.departures("JFK");
      yield* Effect.exit(api.flight("XX999"));
      expect(entries.map((e) => [e.request, e.outcome])).toStrictEqual([
        ["departures JFK", { _tag: "Ok" }],
        ["flight XX999", { _tag: "Failed", error: "FlightNotFound" }],
      ]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("records an interrupted request as Cancelled", () => {
    const { entries, layer } = logged(layerInMemory({ latency: "1 hour" }));
    return Effect.gen(function* () {
      const api = yield* FlightApi;
      const fiber = yield* Effect.forkChild(api.search("KL"));
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(fiber);
      expect(entries.map((e) => e.outcome)).toStrictEqual([{ _tag: "Cancelled" }]);
    }).pipe(Effect.provide(layer));
  });
});
