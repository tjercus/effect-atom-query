/**
 * Two small stores that live outside any runtime, so they survive a backend
 * swap: the chaos knobs (read by the chaos layer on every request) and the
 * request log (written by the request-log layer).
 */
import { useSyncExternalStore } from "react";
import { calmChaos, type ChaosSettings, type RequestLogEntry } from "./api/layers.ts";

export interface Store<A> {
  readonly get: () => A;
  readonly set: (f: (a: A) => A) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

export const makeStore = <A>(initial: A): Store<A> => {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (f) => {
      value = f(value);
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

export const useStore = <A>(store: Store<A>): A => useSyncExternalStore(store.subscribe, store.get);

export const chaosStore = makeStore<ChaosSettings>({
  ...calmChaos,
  failureRate: 0.4,
  extraLatencyMs: 400,
  // Opt in with the slider: a defect takes a panel down until "Try again".
  defectRate: 0,
});

const LOG_SIZE = 40;

export const requestLog = makeStore<ReadonlyArray<RequestLogEntry>>([]);

export const recordRequest = (entry: RequestLogEntry): void =>
  requestLog.set((log) => [entry, ...log].slice(0, LOG_SIZE));
