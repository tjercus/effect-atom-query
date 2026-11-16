/**
 * A small flight API served by the Vite dev (and preview) server, so the HTTP
 * backend makes real requests without any external service:
 *
 * - GET /api/departures/:airport
 * - GET /api/flights/:flightNo   (404 when unknown)
 * - GET /api/search?q=term       (slow on purpose)
 *
 * It never fails on its own. Failures come from the chaos layer in the client,
 * so they work the same for every backend.
 */
import type { Connect, Plugin } from "vite-plus";
import { airports, type Airport } from "../src/api/domain.ts";
import { departuresAt, flightAt, searchAt } from "../src/api/flightData.ts";

const isAirport = (s: string): s is Airport => (airports as ReadonlyArray<string>).includes(s);

const handler: Connect.NextHandleFunction = (req, res, next) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method !== "GET" || !url.pathname.startsWith("/api/")) {
    return next();
  }

  const send = (status: number, body: unknown, delayMs: number) => {
    const timer = setTimeout(() => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    }, delayMs);
    // The client aborted (a cancelled query): stop working on it.
    req.on("close", () => clearTimeout(timer));
  };
  const jitter = () => Math.round(Math.random() * 150);
  const now = Date.now();
  const [, , resource = "", param = ""] = url.pathname.split("/");

  if (resource === "departures" && isAirport(param)) {
    return send(200, departuresAt(param, now), 250 + jitter());
  }
  if (resource === "flights" && param !== "") {
    const flight = flightAt(decodeURIComponent(param), now);
    return flight === undefined
      ? send(404, { error: "not found" }, 200 + jitter())
      : send(200, flight, 200 + jitter());
  }
  if (resource === "search") {
    return send(200, searchAt(url.searchParams.get("q") ?? "", now), 900 + jitter());
  }
  return send(404, { error: "unknown endpoint" }, 0);
};

export const flightServer = (): Plugin => ({
  name: "flight-dashboard:api",
  configureServer: (server) => {
    server.middlewares.use(handler);
  },
  configurePreviewServer: (server) => {
    server.middlewares.use(handler);
  },
});
