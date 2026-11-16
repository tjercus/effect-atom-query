import { describe, expect, it } from "vite-plus/test";
import { departuresAt } from "../src/api/flightData.ts";
import { median } from "../src/components/Stats.tsx";

describe("departuresAt", () => {
  it("moves a flight's status on as the clock advances", () => {
    const flightNo = departuresAt("AMS", 0).find((f) => f.status !== "Cancelled")!.flightNo;
    // One simulated minute is 2 s, so this samples a full 140-minute cycle.
    const statuses = new Set(
      Array.from({ length: 140 }, (_, minute) => {
        const flight = departuresAt("AMS", minute * 2_000).find((f) => f.flightNo === flightNo)!;
        return flight.status;
      }),
    );
    expect(statuses.has("Departed")).toBe(true);
    expect(statuses.has("Boarding")).toBe(true);
    expect(statuses.size).toBeGreaterThanOrEqual(3);
  });

  it("is deterministic for a given time", () => {
    expect(departuresAt("LHR", 123_456)).toStrictEqual(departuresAt("LHR", 123_456));
  });
});

describe("median", () => {
  it("is undefined for no values", () => {
    expect(median([])).toBeUndefined();
  });

  it("is the middle value for an odd count", () => {
    expect(median([100, 300, 900])).toBe(300);
  });

  it("averages the middle two for an even count", () => {
    expect(median([100, 900])).toBe(500);
  });
});
