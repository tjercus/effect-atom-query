/**
 * Deterministic fake flight data, shared by the in-memory backend and the dev
 * server behind the HTTP backend. Status and position depend on the clock, so
 * polling shows a board that changes.
 *
 * Plain functions without Effect: `vite.config.ts` imports this too.
 */
import type { Airport, Flight, FlightDetail } from "./domain.ts";

const airlines = [
  { code: "KL", name: "KLM" },
  { code: "BA", name: "British Airways" },
  { code: "DL", name: "Delta" },
  { code: "UA", name: "United" },
  { code: "LH", name: "Lufthansa" },
] as const;

const destinations = ["CDG", "FRA", "MAD", "BCN", "DXB", "HND", "SIN", "ORD", "BOS", "LAX"];
const aircraft = ["A320neo", "B737-800", "A350-900", "B787-9", "E195-E2"];

/** A small, stable hash so every flight gets the same attributes each time. */
const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

const pad = (n: number) => String(n).padStart(2, "0");

const MINUTE = 60_000;
/** One simulated "minute" passes every 2 real seconds, so the board moves. */
const simulatedMinutes = (now: number) => Math.floor(now / 2_000);

const makeFlight = (airport: Airport, index: number, now: number): Flight => {
  const airline = airlines[index % airlines.length]!;
  const number = 100 + ((hash(`${airport}${index}`) % 900) | 0);
  const flightNo = `${airline.code}${number}`;
  const h = hash(flightNo);
  // Each flight cycles through a 140-minute window, from two hours out to 20
  // minutes after departure, so its status moves on as the clock advances.
  const clock = simulatedMinutes(now);
  const offset = index * 11 + (h % 7);
  const scheduledAt = clock + 119 - ((clock + offset) % 140);
  const delayMinutes = h % 5 === 0 ? 15 + (h % 40) : 0;
  const minutesToGo = scheduledAt + delayMinutes - clock;
  const status: Flight["status"] =
    h % 23 === 0
      ? "Cancelled"
      : minutesToGo < 0
        ? "Departed"
        : minutesToGo < 25
          ? "Boarding"
          : delayMinutes > 0
            ? "Delayed"
            : "Scheduled";
  const minuteOfDay = ((scheduledAt % 1440) + 1440) % 1440;
  return {
    flightNo,
    airline: airline.name,
    from: airport,
    to: destinations[h % destinations.length]!,
    scheduled: `${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}`,
    gate: `${"ABCDE"[h % 5]}${(h % 30) + 1}`,
    status,
    delayMinutes,
  };
};

const FLIGHTS_PER_AIRPORT = 12;

export const departuresAt = (airport: Airport, now: number): ReadonlyArray<Flight> =>
  Array.from({ length: FLIGHTS_PER_AIRPORT }, (_, i) => makeFlight(airport, i, now)).sort((a, b) =>
    a.scheduled.localeCompare(b.scheduled),
  );

const allAirports: ReadonlyArray<Airport> = ["AMS", "LHR", "JFK", "SFO"];

export const allFlightsAt = (now: number): ReadonlyArray<Flight> =>
  allAirports.flatMap((airport) => departuresAt(airport, now));

/** `undefined` when no flight has that number. */
export const flightAt = (flightNo: string, now: number): FlightDetail | undefined => {
  const flight = allFlightsAt(now).find((f) => f.flightNo === flightNo.toUpperCase());
  if (flight === undefined) return undefined;
  const h = hash(flight.flightNo);
  const airborne = flight.status === "Departed";
  // Climb to cruise over a few simulated minutes, with a little turbulence.
  const wobble = Math.round(Math.sin(now / MINUTE + h) * 300);
  return {
    ...flight,
    aircraft: aircraft[h % aircraft.length]!,
    altitudeFt: airborne ? 34_000 + wobble : 0,
    speedKts: airborne ? 460 + (h % 40) : 0,
    updatedAt: new Date(now).toISOString(),
  };
};

export const searchAt = (term: string, now: number): ReadonlyArray<Flight> => {
  const t = term.trim().toUpperCase();
  if (t === "") return [];
  return allFlightsAt(now).filter(
    (f) => f.flightNo.includes(t) || f.to.includes(t) || f.airline.toUpperCase().includes(t),
  );
};
