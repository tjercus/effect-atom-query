import { renderHook, waitFor } from "@testing-library/react";
import { Effect, Option } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { Query, useQuery } from "../src/index.ts";
import { counter, makeClient, wrapper } from "./utils.tsx";

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});
const setup = () => {
  const c = makeClient();
  disposers.push(c.dispose);
  return c;
};

const setVisibility = (state: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  window.dispatchEvent(new Event("visibilitychange"));
};

describe("browser triggers (default managers)", () => {
  it("refetches on visibilitychange back to visible", async () => {
    const { client } = setup();
    const runs = counter();
    const q = Query.single({ key: ["visibility"], run: Effect.sync(runs.next) });
    const { result } = renderHook(() => useQuery(q), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.data).toEqual(Option.some(1)));
    setVisibility("hidden");
    setVisibility("visible");
    await waitFor(() => expect(result.current.data).toEqual(Option.some(2)));
  });

  it("pauses while offline and resumes on the online event", async () => {
    const { client } = setup();
    const q = Query.single({ key: ["offline"], run: Effect.succeed("back online") });
    window.dispatchEvent(new Event("offline"));
    const { result } = renderHook(() => useQuery(q), { wrapper: wrapper(client) });
    expect(result.current).toMatchObject({ status: "pending", fetchStatus: "paused" });
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(result.current.data).toEqual(Option.some("back online")));
  });

  it("polls with refetchInterval from the hook", async () => {
    const { client } = setup();
    const runs = counter();
    const q = Query.single({ key: ["hook-poll"], run: Effect.sync(runs.next) });
    const { result } = renderHook(() => useQuery(q, { refetchInterval: "20 millis" }), {
      wrapper: wrapper(client),
    });
    await waitFor(() =>
      expect(Option.getOrElse(result.current.data, () => 0)).toBeGreaterThanOrEqual(3),
    );
  });
});
