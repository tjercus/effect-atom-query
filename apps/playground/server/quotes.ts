/**
 * A tiny quote server for the "Live updates" example, as a Vite plugin: it
 * runs inside `vp dev` and `vp preview`, so the example needs no second
 * process.
 *
 * - `GET /api/quotes` returns a snapshot of all quotes (after a short delay,
 *   so that updates arrive while it is under way).
 * - A WebSocket on `/api/quotes/live` sends each quote that changes.
 * - `POST /api/quotes/drop` cuts every connection, to show reconnecting.
 *
 * Each quote has a `version` that goes up by one per change, so a client can
 * tell an old update from a new one.
 */
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { WebSocketServer } from "ws";

interface Quote {
  readonly symbol: string;
  readonly price: number;
  readonly version: number;
}

const SNAPSHOT_PATH = "/api/quotes";
const DROP_PATH = "/api/quotes/drop";
const LIVE_PATH = "/api/quotes/live";
const SNAPSHOT_DELAY_MS = 400;
const TICK_MS = 1000;

const attach = (
  httpServer: Server,
  use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void,
): void => {
  const quotes = new Map<string, Quote>(
    ["ATLS", "BORE", "CYGN", "DRCO", "ERID"].map((symbol, index) => [
      symbol,
      { symbol, price: 100 + index * 25, version: 1 },
    ]),
  );
  const sockets = new WebSocketServer({ noServer: true });

  const tick = setInterval(() => {
    const symbols = [...quotes.keys()];
    const symbol = symbols[Math.floor(Math.random() * symbols.length)];
    const current = symbol === undefined ? undefined : quotes.get(symbol);
    if (current === undefined) {
      return;
    }
    const change = Math.round((Math.random() - 0.5) * 400) / 100;
    const next: Quote = {
      symbol: current.symbol,
      price: Math.max(1, Math.round((current.price + change) * 100) / 100),
      version: current.version + 1,
    };
    quotes.set(next.symbol, next);
    const message = JSON.stringify(next);
    for (const client of sockets.clients) {
      client.send(message);
    }
  }, TICK_MS);

  httpServer.on("close", () => {
    clearInterval(tick);
    sockets.close();
  });

  // Vite's own WebSocket (hot reload) listens on the same server: only take
  // the upgrade requests for our path.
  httpServer.on("upgrade", (req, socket, head) => {
    if (req.url === LIVE_PATH) {
      sockets.handleUpgrade(req, socket, head, (client) => {
        // Without a listener, a malformed frame from one client would be an
        // uncaught error that stops the whole dev server.
        client.on("error", () => client.terminate());
        sockets.emit("connection", client, req);
      });
    }
  });

  use((req, res, next) => {
    if (req.url === SNAPSHOT_PATH && req.method === "GET") {
      const snapshot = JSON.stringify([...quotes.values()]);
      setTimeout(() => {
        res.setHeader("Content-Type", "application/json");
        res.end(snapshot);
      }, SNAPSHOT_DELAY_MS);
    } else if (req.url === DROP_PATH && req.method === "POST") {
      for (const client of sockets.clients) {
        // Without a closing handshake, as when the network goes away.
        client.terminate();
      }
      res.statusCode = 204;
      res.end();
    } else {
      next();
    }
  });
};

export const quoteServer = (): Plugin => ({
  name: "playground-quote-server",
  configureServer(server) {
    if (server.httpServer !== null) {
      attach(server.httpServer as Server, (handler) => server.middlewares.use(handler));
    }
  },
  configurePreviewServer(server) {
    attach(server.httpServer as Server, (handler) => server.middlewares.use(handler));
  },
});
