import { act, render, screen, waitFor } from "@testing-library/react";
import { Effect, Option, Queue, Stream } from "effect";
import * as React from "react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { Query, useQuery } from "../src/index.ts";
import { makeClient, wrapper } from "./utils.tsx";

const disposers: Array<() => Promise<void>> = [];
const setup = () => {
  const c = makeClient();
  disposers.push(c.dispose);
  return c;
};
afterEach(async () => {
  for (const dispose of disposers.splice(0)) {
    await dispose();
  }
});

/** A fake connection: each run of `updates` opens one; the test emits and fails. */
const makeSource = () => {
  let queue: Queue.Queue<number, string> | undefined;
  const state = { opened: 0 };
  const withQueue = (f: (q: Queue.Queue<number, string>) => Effect.Effect<boolean>) =>
    act(async () => {
      if (queue !== undefined) {
        await Effect.runPromise(f(queue));
      }
    });
  return {
    state,
    updates: Stream.unwrap(
      Effect.map(Queue.unbounded<number, string>(), (q) => {
        queue = q;
        state.opened++;
        return Stream.fromQueue(q);
      }),
    ),
    emit: (n: number) => withQueue((q) => Queue.offer(q, n)),
    fail: (error: string) => withQueue((q) => Queue.fail(q, error)),
  };
};

const totalQuery = (key: string, source: ReturnType<typeof makeSource>) =>
  Query.single({
    key: [key],
    run: Effect.succeed(1),
    // Idempotent: the total only ever grows to the latest value.
    stream: { updates: source.updates, apply: (total, next) => Math.max(total, next) },
    staleTime: "Infinity",
  });

describe("useQuery with a stream", () => {
  it("connects once under StrictMode and renders updates", async () => {
    const { client } = setup();
    const source = makeSource();
    const q = totalQuery("strict-stream", source);
    function View() {
      const r = useQuery(q);
      return (
        <p>
          {Option.getOrElse(r.data, () => 0)} {r.streamStatus}
        </p>
      );
    }
    render(
      <React.StrictMode>
        <View />
      </React.StrictMode>,
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(screen.getByText("1 open")).toBeTruthy());
    await source.emit(5);
    await waitFor(() => expect(screen.getByText("5 open")).toBeTruthy());
    expect(source.state.opened).toBe(1);
  });

  it("does not re-render for a stream failure the component does not read", async () => {
    const { client } = setup();
    const source = makeSource();
    const q = totalQuery("tracked-stream", source);
    const renders = { count: 0 };
    function View() {
      renders.count++;
      const r = useQuery(q);
      return <p>total {Option.getOrElse(r.data, () => 0)}</p>;
    }
    render(<View />, { wrapper: wrapper(client) });
    await waitFor(() => expect(screen.getByText("total 1")).toBeTruthy());
    const before = renders.count;
    await source.fail("connection lost");
    const state = await Effect.runPromise(client.getQueryState(q));
    expect(Option.getOrThrow(state).streamStatus).toBe("reconnecting");
    expect(renders.count).toBe(before);
  });
});
