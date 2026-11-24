/**
 * The client side of the quote server (`server/quotes.ts`): a snapshot over
 * HTTP and updates over a WebSocket, as an Effect service so that tests can
 * replace it.
 */
import { Cause, Context, Effect, Layer, Option, Queue, Schema, Stream } from "effect";
import { ApiError } from "./api.ts";

export const Quote = Schema.Struct({
  symbol: Schema.String,
  price: Schema.Number,
  /** Goes up by one with each change of this quote. */
  version: Schema.Number,
});
export type Quote = typeof Quote.Type;

export class Quotes extends Context.Service<
  Quotes,
  {
    /** All quotes, as they are now. */
    readonly snapshot: Effect.Effect<ReadonlyArray<Quote>, ApiError>;
    /** Each quote that changes, for as long as the stream runs. Fails when the connection is lost. */
    readonly updates: Stream.Stream<Quote, ApiError>;
    /** Asks the server to cut every connection. */
    readonly drop: Effect.Effect<void, ApiError>;
  }
>()("playground/Quotes") {}

const decodeSnapshot = Schema.decodeUnknownOption(Schema.Array(Quote));
const decodeUpdate = Schema.decodeUnknownOption(Schema.fromJsonString(Quote));

const request = (path: string, init?: RequestInit): Effect.Effect<Response, ApiError> =>
  Effect.tryPromise({
    try: (signal) => fetch(path, { ...init, signal }),
    catch: () => new ApiError({ message: "The quote server cannot be reached" }),
  }).pipe(
    Effect.filterOrFail(
      (response) => response.ok,
      (response) => new ApiError({ message: `The quote server answered ${response.status}` }),
    ),
  );

const snapshot: Effect.Effect<ReadonlyArray<Quote>, ApiError> = request("/api/quotes").pipe(
  Effect.flatMap((response) =>
    Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: () => new ApiError({ message: "The quote server sent no JSON" }),
    }),
  ),
  Effect.flatMap((json) =>
    Option.match(decodeSnapshot(json), {
      onNone: () => Effect.fail(new ApiError({ message: "The quote server sent no quotes" })),
      onSome: Effect.succeed,
    }),
  ),
);

/**
 * One WebSocket connection as a stream. Each run opens a connection; when the
 * stream is interrupted the connection is closed. A lost connection fails the
 * stream, which lets the query retry it and refetch what was missed.
 */
const updates: Stream.Stream<Quote, ApiError> = Stream.callback<Quote, ApiError>((queue) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${scheme}://${window.location.host}/api/quotes/live`);
      socket.addEventListener("message", (event) => {
        const quote = decodeUpdate(event.data);
        if (Option.isSome(quote)) {
          Queue.offerUnsafe(queue, quote.value);
        }
      });
      socket.addEventListener("close", () => {
        Queue.failCauseUnsafe(
          queue,
          Cause.fail(new ApiError({ message: "The connection to the quote server was lost" })),
        );
      });
      return socket;
    }),
    (socket) => Effect.sync(() => socket.close()),
  ),
);

export const QuotesLive: Layer.Layer<Quotes> = Layer.succeed(Quotes, {
  snapshot,
  updates,
  drop: Effect.asVoid(request("/api/quotes/drop", { method: "POST" })),
});
