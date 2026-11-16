/**
 * The retry policy is a plain `Schedule`, so it is tested as an Effect with
 * the TestClock: no React, no client, no real waiting.
 */
import { it } from "@effect/vitest";
import { Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it as test } from "vite-plus/test";
import {
  BadResponse,
  type FlightApiError,
  FlightNotFound,
  RateLimited,
  UpstreamUnavailable,
} from "../src/api/domain.ts";
import { flightRetry, MAX_RETRIES, pollUnlessPermanent } from "../src/queries.ts";
import { QueryResult } from "@effect-atom-query/react";

/** An Effect that fails with `errors` in turn, then succeeds; counts attempts. */
const flaky = (errors: ReadonlyArray<FlightApiError>) => {
  let attempts = 0;
  const effect = Effect.suspend(() => {
    const error = errors[attempts++];
    return error === undefined ? Effect.succeed("ok") : Effect.fail(error);
  });
  return { effect, attempts: () => attempts };
};

/** Runs with the retry policy, letting plenty of test time pass. */
const runRetried = <A>(effect: Effect.Effect<A, FlightApiError>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(Effect.exit(Effect.retry(effect, flightRetry)));
    yield* TestClock.adjust("10 minutes");
    return yield* Fiber.join(fiber);
  });

describe("flightRetry", () => {
  it.effect("retries transient errors until the request succeeds", () =>
    Effect.gen(function* () {
      const request = flaky([
        new UpstreamUnavailable({ status: 503 }),
        new RateLimited({ retryAfterMs: 1000 }),
      ]);
      const exit = yield* runRetried(request.effect);
      expect(exit).toStrictEqual(Exit.succeed("ok"));
      expect(request.attempts()).toBe(3);
    }),
  );

  it.effect("never retries a FlightNotFound", () =>
    Effect.gen(function* () {
      const request = flaky([new FlightNotFound({ flightNo: "XX999" })]);
      const exit = yield* runRetried(request.effect);
      expect(exit).toStrictEqual(Exit.fail(new FlightNotFound({ flightNo: "XX999" })));
      expect(request.attempts()).toBe(1);
    }),
  );

  it.effect("never retries a BadResponse", () =>
    Effect.gen(function* () {
      const request = flaky([new BadResponse({ reason: "nope" })]);
      yield* runRetried(request.effect);
      expect(request.attempts()).toBe(1);
    }),
  );

  it.effect(`gives up after ${MAX_RETRIES} retries`, () =>
    Effect.gen(function* () {
      const request = flaky(
        Array.from({ length: 10 }, () => new UpstreamUnavailable({ status: 503 })),
      );
      const exit = yield* runRetried(request.effect);
      expect(Exit.isFailure(exit)).toBe(true);
      expect(request.attempts()).toBe(1 + MAX_RETRIES);
    }),
  );

  it.effect("waits at least retryAfterMs after a RateLimited", () =>
    Effect.gen(function* () {
      const request = flaky([new RateLimited({ retryAfterMs: 5000 })]);
      const fiber = yield* Effect.forkChild(Effect.retry(request.effect, flightRetry));
      yield* TestClock.adjust("4900 millis");
      expect(request.attempts()).toBe(1);
      yield* TestClock.adjust("200 millis");
      expect(yield* Fiber.join(fiber)).toBe("ok");
      expect(request.attempts()).toBe(2);
    }),
  );
});

describe("pollUnlessPermanent", () => {
  const poll = pollUnlessPermanent("3 seconds");

  test("keeps polling on success and on transient errors", () => {
    expect(poll(QueryResult.success([]))).toBe("3 seconds");
    expect(poll(QueryResult.failure(new RateLimited({ retryAfterMs: 1000 })))).toBe("3 seconds");
  });

  test("stops polling on an error that polling cannot fix", () => {
    expect(poll(QueryResult.failure(new FlightNotFound({ flightNo: "XX999" })))).toBe(false);
    expect(poll(QueryResult.failure(new BadResponse({ reason: "nope" })))).toBe(false);
  });
});
