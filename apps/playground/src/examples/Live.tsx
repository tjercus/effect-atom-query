import { Mutation, Query, useMutation, useQuery } from "@effect-atom-query/react";
import { Effect, Option, Stream } from "effect";
import { useState } from "react";
import { type Quote, Quotes } from "../quotes.ts";
import { type Example, StaleDataError, Status } from "../ui.tsx";

/**
 * Puts one changed quote into the list. Applying the same update twice
 * changes nothing, and an update older than what the list holds is ignored:
 * the snapshot of a refetch can be newer than an update that was under way.
 */
export const applyQuote = (quotes: ReadonlyArray<Quote>, update: Quote): ReadonlyArray<Quote> => {
  const current = quotes.find((quote) => quote.symbol === update.symbol);
  if (current === undefined) {
    return [...quotes, update];
  }
  return current.version >= update.version
    ? quotes
    : quotes.map((quote) => (quote.symbol === update.symbol ? update : quote));
};

const quotesQuery = Query.single({
  key: ["quotes"],
  // The snapshot: fetched once, and again after the stream missed updates.
  run: Quotes.use((quotes) => quotes.snapshot),
  stream: {
    // The updates: a WebSocket that runs while a component shows the quotes.
    updates: Stream.unwrap(Quotes.use((quotes) => Effect.succeed(quotes.updates))),
    apply: applyQuote,
  },
  // The stream keeps the data current, so time does not make it stale.
  staleTime: "Infinity",
});

const dropConnections = Mutation.make({
  key: ["quotes", "drop"],
  run: () => Quotes.use((quotes) => quotes.drop),
});

const streamLabels = {
  idle: "not running",
  open: "open",
  reconnecting: "reconnecting…",
  closed: "closed",
} as const;

function QuoteTable() {
  const quotes = useQuery(quotesQuery);
  const drop = useMutation(dropConnections);
  const stream = quotes.stream;

  return (
    <div>
      <p>
        Stream:{" "}
        <strong data-testid="stream-status">{streamLabels[stream?.status ?? "idle"]}</strong>{" "}
        <span className={quotes.isFetching ? "fetch-dot on" : "fetch-dot"} />{" "}
        <Status result={quotes} />
      </p>
      {stream !== undefined && Option.isSome(stream.error) ? (
        <p className="error">Stream: {describe(stream.error.value)}</p>
      ) : null}
      {quotes.status === "pending" ? <p>Loading…</p> : null}
      {quotes.status === "error" && Option.isNone(quotes.data) ? (
        <p className="error">
          Error: {Option.match(quotes.error, { onNone: () => "defect", onSome: (e) => e.message })}{" "}
          (the quote server runs with <code>vp dev</code> and <code>vp preview</code>)
        </p>
      ) : null}
      {quotes.status === "error" && Option.isSome(quotes.data) ? (
        <StaleDataError failure={quotes} />
      ) : null}
      {Option.match(quotes.data, {
        onNone: () => null,
        onSome: (list) => (
          <table className="quotes">
            <thead>
              <tr>
                <th align="left">Symbol</th>
                <th align="right">Price</th>
                <th align="right">Version</th>
              </tr>
            </thead>
            <tbody>
              {list.map((quote) => (
                <tr key={quote.symbol}>
                  <td>{quote.symbol}</td>
                  <td align="right">{quote.price.toFixed(2)}</td>
                  <td align="right">{quote.version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ),
      })}
      <p>
        <button onClick={() => drop.mutate()} disabled={drop.isPending}>
          Drop the connection
        </button>{" "}
        <button onClick={() => quotes.refetch()}>Refetch the snapshot</button>
      </p>
      <p className="muted">
        The server changes one quote per second. After a drop the stream reconnects after a second,
        and the first update that arrives triggers one refetch for what was missed: watch the dot.
      </p>
    </div>
  );
}

/** `stream.error` is typed `unknown`: narrow it before showing it. */
const describe = (error: unknown): string =>
  typeof error === "object" &&
  error !== null &&
  "message" in error &&
  typeof error.message === "string"
    ? error.message
    : "the stream failed";

function Live() {
  const [shown, setShown] = useState(true);
  return (
    <div>
      <label>
        <input type="checkbox" checked={shown} onChange={(e) => setShown(e.target.checked)} /> Show
        the quotes
      </label>
      <p className="muted">
        Hiding them unmounts the only observer. The connection stays for one second, so that a quick
        remount does not reconnect, and is then closed.
      </p>
      {shown ? <QuoteTable /> : null}
    </div>
  );
}

export const example: Example = {
  id: "live",
  title: "Live updates (WebSocket)",
  tanstack: "none",
  description: (
    <>
      A snapshot over HTTP kept current by a WebSocket: <code>stream</code> on the query, with
      reconnecting.
    </>
  ),
  Component: Live,
};
