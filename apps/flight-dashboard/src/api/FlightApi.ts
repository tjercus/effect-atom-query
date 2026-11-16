/**
 * The `FlightApi` service. Queries depend on this interface only; which
 * implementation serves it is decided by the layer the runtime is built from.
 */
import { Context, type Effect } from "effect";
import type {
  Airport,
  BadResponse,
  Flight,
  FlightDetail,
  FlightNotFound,
  TransientError,
} from "./domain.ts";

export class FlightApi extends Context.Service<
  FlightApi,
  {
    /** The departures board of an airport. */
    readonly departures: (
      airport: Airport,
    ) => Effect.Effect<ReadonlyArray<Flight>, TransientError | BadResponse>;
    /** One flight, with its live position. */
    readonly flight: (
      flightNo: string,
    ) => Effect.Effect<FlightDetail, TransientError | FlightNotFound | BadResponse>;
    /** Flights whose number, airline or destination matches. Slow on purpose. */
    readonly search: (
      term: string,
    ) => Effect.Effect<ReadonlyArray<Flight>, TransientError | BadResponse>;
  }
>()("flight-dashboard/FlightApi") {}
