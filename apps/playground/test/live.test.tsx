/**
 * The "Live updates" example against a fake quote server: a snapshot, and a
 * connection that the test feeds and breaks.
 */
import { makeTestHarness, type TestHarness } from "@effect-atom-query/react/testing";
import { act, render, screen, waitFor } from "@testing-library/react";
import { Effect, Layer, Queue, Stream } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { ApiError } from "../src/api.ts";
import { applyQuote, example } from "../src/examples/Live.tsx";
import { type Quote, Quotes } from "../src/quotes.ts";

const quote = (symbol: string, price: number, version: number): Quote => ({
  symbol,
  price,
  version,
});

/** A quote server whose connection the test controls. */
const fakeQuotes = () => {
  let connection: Queue.Queue<Quote, ApiError> | undefined;
  const state = { connections: 0, snapshots: 0 };
  const server = { quotes: [quote("ATLS", 100, 1)] as ReadonlyArray<Quote> };
  const withConnection = (f: (queue: Queue.Queue<Quote, ApiError>) => Effect.Effect<boolean>) =>
    act(() =>
      connection === undefined ? Promise.resolve(false) : Effect.runPromise(f(connection)),
    );
  return {
    state,
    server,
    layer: Layer.succeed(Quotes, {
      snapshot: Effect.sync(() => {
        state.snapshots++;
        return server.quotes;
      }),
      updates: Stream.unwrap(
        Effect.map(Queue.unbounded<Quote, ApiError>(), (queue) => {
          connection = queue;
          state.connections++;
          return Stream.fromQueue(queue);
        }),
      ),
      drop: Effect.void,
    }),
    send: (update: Quote) => {
      server.quotes = applyQuote(server.quotes, update);
      return withConnection((queue) => Queue.offer(queue, update));
    },
    lose: () =>
      withConnection((queue) => Queue.fail(queue, new ApiError({ message: "connection lost" }))),
  };
};

let harness: TestHarness<Quotes, never> | undefined;
afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

const renderLive = (quotes: ReturnType<typeof fakeQuotes>) => {
  harness = makeTestHarness({ layer: quotes.layer });
  const { Component } = example;
  render(<Component />, { wrapper: harness.Wrapper });
};

describe("Live", () => {
  it("shows the snapshot and applies updates from the stream", async () => {
    const quotes = fakeQuotes();
    renderLive(quotes);
    expect(await screen.findByText("100.00")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("stream-status").textContent).toBe("open"));

    await quotes.send(quote("ATLS", 101.5, 2));
    expect(await screen.findByText("101.50")).toBeTruthy();
    await quotes.send(quote("BORE", 125, 1));
    expect(await screen.findByText("BORE")).toBeTruthy();
    // The stream delivered them: no second snapshot.
    expect(quotes.state.snapshots).toBe(1);
  });

  it("ignores an update that is older than what is shown", async () => {
    const quotes = fakeQuotes();
    renderLive(quotes);
    expect(await screen.findByText("100.00")).toBeTruthy();
    await quotes.send(quote("ATLS", 103, 3));
    expect(await screen.findByText("103.00")).toBeTruthy();
    await quotes.send(quote("ATLS", 102, 2));
    expect(screen.getByText("103.00")).toBeTruthy();
    expect(screen.queryByText("102.00")).toBeNull();
  });

  it("shows a lost connection and keeps the quotes", async () => {
    const quotes = fakeQuotes();
    renderLive(quotes);
    expect(await screen.findByText("100.00")).toBeTruthy();
    await waitFor(() => expect(quotes.state.connections).toBe(1));

    await quotes.lose();
    await waitFor(() =>
      expect(screen.getByTestId("stream-status").textContent).toBe("reconnecting…"),
    );
    expect(screen.getByText("Stream: connection lost")).toBeTruthy();
    expect(screen.getByText("100.00")).toBeTruthy();
  });
});
