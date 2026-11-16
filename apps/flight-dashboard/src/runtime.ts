/**
 * Building the app's runtime from a backend choice. This is the only place
 * that knows which `FlightApi` is in use.
 */
import { QueryClient } from "@effect-atom-query/react";
import { Layer, ManagedRuntime } from "effect";
import type { FlightApi } from "./api/FlightApi.ts";
import { layerChaos, layerHttp, layerInMemory, layerRequestLog } from "./api/layers.ts";
import { chaosStore, recordRequest } from "./store.ts";

export type Backend = "http" | "memory";

export interface BackendChoice {
  readonly backend: Backend;
  readonly chaos: boolean;
}

/** The `FlightApi` for a choice: a base layer, optionally decorated with chaos, always logged. */
export const flightApiLayer = (choice: BackendChoice): Layer.Layer<FlightApi> => {
  const base = choice.backend === "http" ? layerHttp() : layerInMemory();
  const api = choice.chaos
    ? layerChaos({ settings: chaosStore.get }).pipe(Layer.provide(base))
    : base;
  return layerRequestLog(recordRequest).pipe(Layer.provide(api));
};

/** The same composition, as code, for the header to show. */
export const describeLayer = (choice: BackendChoice): string => {
  const base = choice.backend === "http" ? "layerHttp()" : "layerInMemory()";
  const api = choice.chaos ? `layerChaos(…).pipe(Layer.provide(${base}))` : base;
  return `layerRequestLog(…).pipe(Layer.provide(${api}))`;
};

export const makeRuntime = (choice: BackendChoice) =>
  ManagedRuntime.make(QueryClient.layer().pipe(Layer.provideMerge(flightApiLayer(choice))));

export type AppRuntime = ReturnType<typeof makeRuntime>;
