/**
 * Tracks network connectivity. With `networkMode: "online"` (the default)
 * fetches pause while offline and continue on reconnect; active stale queries
 * refetch on reconnect (`refetchOnReconnect`).
 *
 * Like TanStack Query v5, the manager starts out online (`navigator.onLine`
 * is unreliable) and follows the browser's `online` / `offline` events.
 *
 * @since 0.1.0
 */
import { Context, Effect, Layer } from "effect";

/**
 * @since 0.1.0
 * @category models
 */
export interface Service {
  readonly isOnline: () => boolean;
  /** Called with the new state on every change. */
  readonly subscribe: (listener: (online: boolean) => void) => () => void;
  readonly setOnline: (online: boolean) => void;
}

/**
 * @since 0.1.0
 * @category models
 */
export interface Options {
  /** Wire up environment events; call `setOnline` on change and return a cleanup. */
  readonly setup?: ((setOnline: (online: boolean) => void) => () => void) | undefined;
  readonly initialOnline?: boolean | undefined;
}

const browserSetup = (setOnline: (online: boolean) => void): (() => void) => {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function")
    return () => {};
  const online = () => setOnline(true);
  const offline = () => setOnline(false);
  window.addEventListener("online", online, false);
  window.addEventListener("offline", offline, false);
  return () => {
    window.removeEventListener("online", online);
    window.removeEventListener("offline", offline);
  };
};

/**
 * @since 0.1.0
 * @category constructors
 */
export const make = (options: Options = {}): Service => {
  const setup = options.setup ?? browserSetup;
  const listeners = new Set<(online: boolean) => void>();
  let online = options.initialOnline ?? true;
  let cleanup: (() => void) | undefined;

  const setOnline = (next: boolean) => {
    if (next === online) return;
    online = next;
    for (const listener of Array.from(listeners)) listener(online);
  };

  return {
    isOnline: () => online,
    subscribe: (listener) => {
      if (listeners.size === 0) cleanup = setup(setOnline);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          cleanup?.();
          cleanup = undefined;
        }
      };
    },
    setOnline,
  };
};

/**
 * The online manager clients use. Defaults to a shared browser-backed instance.
 *
 * @since 0.1.0
 * @category services
 */
export const OnlineManager: Context.Reference<Service> = Context.Reference<Service>(
  "@effect-native-query/query/OnlineManager",
  {
    defaultValue: () => make(),
  },
);

/**
 * Provide a dedicated online manager, e.g. for React Native or tests.
 *
 * @since 0.1.0
 * @category layers
 */
export const layer = (options?: Options): Layer.Layer<never> =>
  Layer.succeed(OnlineManager, make(options));

/**
 * @since 0.1.0
 * @category accessors
 */
export const setOnline = (online: boolean): Effect.Effect<void> =>
  Effect.map(OnlineManager, (manager: Service) => manager.setOnline(online));

/**
 * @since 0.1.0
 * @category accessors
 */
export const isOnline: Effect.Effect<boolean> = Effect.map(OnlineManager, (manager: Service) =>
  manager.isOnline(),
);
