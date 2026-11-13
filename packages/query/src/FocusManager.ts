/**
 * Tracks whether the app is focused, so stale queries can refetch when the
 * user comes back (`refetchOnWindowFocus`) and polling can pause in the
 * background (`refetchIntervalInBackground`).
 *
 * The default (used when no layer is provided) listens to the browser's
 * `visibilitychange` event. Elsewhere it reports "focused" and never changes,
 * unless you call `setFocused` or provide a layer with your own `setup`
 * (React Native's `AppState`, Electron, and so on).
 *
 * @since 0.1.0
 */
import { Context, Effect, Layer } from "effect";

/**
 * @since 0.1.0
 * @category models
 */
export interface Service {
  readonly isFocused: () => boolean;
  /** Called with the new state on every change. */
  readonly subscribe: (listener: (focused: boolean) => void) => () => void;
  /** Override the environment (`undefined` returns to it). */
  readonly setFocused: (focused: boolean | undefined) => void;
}

/**
 * @since 0.1.0
 * @category models
 */
export interface Options {
  /**
   * Wire up environment events. Call `onFocus(focused)` whenever focus
   * changes; return a cleanup. Runs while the manager has listeners.
   */
  readonly setup?: ((onFocus: (focused?: boolean) => void) => () => void) | undefined;
  /** The environment's current state when no explicit value is known. */
  readonly isFocused?: (() => boolean) | undefined;
}

const browserIsFocused = (): boolean =>
  typeof document === "undefined" || document.visibilityState !== "hidden";

const browserSetup = (onFocus: (focused?: boolean) => void): (() => void) => {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function")
    return () => {};
  const listener = () => onFocus();
  window.addEventListener("visibilitychange", listener, false);
  return () => window.removeEventListener("visibilitychange", listener);
};

/**
 * @since 0.1.0
 * @category constructors
 */
export const make = (options: Options = {}): Service => {
  const environment = options.isFocused ?? browserIsFocused;
  const setup = options.setup ?? browserSetup;
  const listeners = new Set<(focused: boolean) => void>();
  let explicit: boolean | undefined;
  let last: boolean | undefined;
  let cleanup: (() => void) | undefined;

  const isFocused = () => explicit ?? environment();
  const emit = () => {
    const focused = isFocused();
    if (focused === last) return;
    last = focused;
    for (const listener of Array.from(listeners)) listener(focused);
  };

  return {
    isFocused,
    subscribe: (listener) => {
      if (listeners.size === 0) {
        last = isFocused();
        cleanup = setup((focused) => {
          if (focused !== undefined) explicit = focused;
          emit();
        });
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          cleanup?.();
          cleanup = undefined;
        }
      };
    },
    setFocused: (focused) => {
      explicit = focused;
      emit();
    },
  };
};

/**
 * The focus manager clients use. Defaults to a shared browser-backed instance.
 *
 * @since 0.1.0
 * @category services
 */
export const FocusManager: Context.Reference<Service> = Context.Reference<Service>(
  "@effect-native-query/query/FocusManager",
  {
    defaultValue: () => make(),
  },
);

/**
 * Provide a dedicated focus manager, e.g. for React Native or tests.
 *
 * @since 0.1.0
 * @category layers
 */
export const layer = (options?: Options): Layer.Layer<never> =>
  Layer.succeed(FocusManager, make(options));

/**
 * @since 0.1.0
 * @category accessors
 */
export const setFocused = (focused: boolean | undefined): Effect.Effect<void> =>
  Effect.map(FocusManager, (manager: Service) => manager.setFocused(focused));

/**
 * @since 0.1.0
 * @category accessors
 */
export const isFocused: Effect.Effect<boolean> = Effect.map(FocusManager, (manager: Service) =>
  manager.isFocused(),
);
