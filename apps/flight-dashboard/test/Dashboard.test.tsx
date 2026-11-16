/**
 * Component tests run the real components and the real query definitions,
 * with the same layers the app swaps between, through `makeTestHarness`.
 */
import { makeTestHarness, type TestHarness } from "@effect-atom-query/react/testing";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Layer } from "effect";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { FlightApi } from "../src/api/FlightApi.ts";
import {
  calmChaos,
  type ChaosSettings,
  layerChaos,
  layerInMemory,
  layerRequestLog,
  type RequestLogEntry,
} from "../src/api/layers.ts";
import { Dashboard, type Selection } from "../src/App.tsx";

let harness: TestHarness<FlightApi, never> | undefined;
afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

/** Renders the dashboard against `api`, logging every request it makes. */
const renderWith = (api: Layer.Layer<FlightApi>) => {
  const entries: Array<RequestLogEntry> = [];
  harness = makeTestHarness({
    layer: layerRequestLog((e) => entries.push(e)).pipe(Layer.provide(api)),
  });
  function Host() {
    const [selection, setSelection] = useState<Selection>({ airport: "AMS", flightNo: undefined });
    return <Dashboard selection={selection} onSelection={setSelection} />;
  }
  render(<Host />, { wrapper: harness.Wrapper });
  return entries;
};

const memory = layerInMemory({ latency: 0 });

const chaotic = (settings: Partial<ChaosSettings>, roll: number) =>
  layerChaos({ settings: () => ({ ...calmChaos, ...settings }), random: () => roll }).pipe(
    Layer.provide(memory),
  );

describe("Dashboard", () => {
  it("shows the departures board", async () => {
    renderWith(memory);
    expect(screen.getByText("Loading departures from AMS…")).toBeTruthy();
    // A header row plus one row per flight.
    expect((await screen.findAllByRole("row")).length).toBe(13);
  });

  it("switches airports", async () => {
    const log = renderWith(memory);
    await screen.findAllByRole("row");
    fireEvent.click(screen.getByRole("tab", { name: "SFO" }));
    await waitFor(() => expect(log.map((e) => e.request)).toContain("departures SFO"));
  });

  it("shows FlightNotFound at once, without retrying or polling", { timeout: 10_000 }, async () => {
    const log = renderWith(memory);
    fireEvent.change(screen.getByLabelText("Flight number"), { target: { value: "xx999" } });
    fireEvent.click(screen.getByRole("button", { name: "Look up" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("FlightNotFound");
    expect(alert.textContent).toContain("Not retried");
    // The panel polls every 3 s, but not after an error that polling cannot fix.
    await new Promise((resolve) => setTimeout(resolve, 3500));
    expect(log.filter((e) => e.request === "flight XX999")).toHaveLength(1);
  });

  it("shows which retry is running, and why", async () => {
    // Every request is rate limited; the schedule waits 1.5 s before retrying.
    renderWith(chaotic({ failureRate: 1 }, 0.1));
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Retry 1 of 4");
    expect(status.textContent).toContain("RateLimited");
  });

  it("throws a defect to the panel's error boundary, apart from typed errors", async () => {
    let settings: ChaosSettings = { ...calmChaos, defectRate: 1 };
    const api = layerChaos({ settings: () => settings, random: () => 0.1 }).pipe(
      Layer.provide(memory),
    );
    const log = renderWith(api);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Defect");
    expect(alert.textContent).toContain("Chaos: the flight API crashed");
    // Defects are bugs, so the retry schedule never sees them: one request only.
    expect(log.filter((e) => e.request === "departures AMS")).toHaveLength(1);
    // The other panels keep working.
    expect(screen.getByLabelText("Search flights")).toBeTruthy();

    // Once the API behaves, "Try again" resets the boundary and refetches.
    settings = calmChaos;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect((await screen.findAllByRole("row")).length).toBe(13);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("FlightSearch", () => {
  it("interrupts the superseded search on every keystroke", async () => {
    // Searches never finish on their own here, so only cancellation ends them.
    const log = renderWith(layerInMemory({ latency: "1 hour" }));
    const input = screen.getByLabelText("Search flights");
    fireEvent.change(input, { target: { value: "K" } });
    await screen.findByText("Searching “K”…");
    fireEvent.change(input, { target: { value: "KL" } });

    await waitFor(() =>
      expect(log.map((e) => [e.request, e.outcome._tag])).toContainEqual([
        'search "K"',
        "Cancelled",
      ]),
    );
    expect(screen.getByText("Searching “KL”…")).toBeTruthy();
  });

  it("cancels the running search with the Cancel button", async () => {
    const log = renderWith(layerInMemory({ latency: "1 hour" }));
    fireEvent.change(screen.getByLabelText("Search flights"), { target: { value: "DL" } });
    await screen.findByText("Searching “DL”…");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    await screen.findByText("Cancelled.");
    expect(log.map((e) => [e.request, e.outcome._tag])).toContainEqual([
      'search "DL"',
      "Cancelled",
    ]);
  });
});
