/**
 * Renders a playground example against the fake server without latency,
 * through `makeTestHarness`. The fake server's `failNext` makes exactly one
 * request fail, so tests arm it only while nothing is in flight.
 */
import type { QueryKey } from "@effect-atom-query/react";
import { makeTestHarness, type TestHarness } from "@effect-atom-query/react/testing";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, expect } from "vite-plus/test";
import { Api, ApiNoLatency } from "../src/api.ts";
import type { Example } from "../src/ui.tsx";

let harness: TestHarness<Api, never> | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

/** Makes the next request to the fake server fail. */
export const failNext = (h: TestHarness<Api, never>): Promise<void> =>
  h.run(Api.use((api) => api.failNext));

/** Renders `example`. With `failFirstRequest`, its first request fails. */
export const renderExample = async (
  example: Example,
  options?: { readonly failFirstRequest?: boolean | undefined },
): Promise<TestHarness<Api, never>> => {
  const h = makeTestHarness({ layer: ApiNoLatency });
  harness = h;
  if (options?.failFirstRequest === true) {
    await failNext(h);
  }
  const { Component } = example;
  render(<Component />, { wrapper: h.Wrapper });
  return h;
};

/** Waits until no query is fetching, so the next request is the one we trigger. */
export const settled = (h: TestHarness<Api, never>): Promise<void> =>
  waitFor(async () => expect(await h.run(h.client.isFetching())).toBe(0));

/** Refetches the queries under `queryKey`, with that one request failing. */
export const failRefetch = async (
  h: TestHarness<Api, never>,
  queryKey: QueryKey.QueryKey,
): Promise<void> => {
  await settled(h);
  await failNext(h);
  await act(() => h.run(h.client.refetchQueries({ queryKey })));
};

export const STALE = "(showing the last loaded data)";
export const FAILED = "Error: The server had a bad day (failNext)";
