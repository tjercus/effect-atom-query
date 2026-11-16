import { QueryClient } from "@effect-atom-query/query";
import { RegistryContext, RegistryProvider } from "@effect/atom-react";
import { type ManagedRuntime, Option } from "effect";
import type { AtomRegistry } from "effect/reactivity";
import * as React from "react";

const QueryClientContext = React.createContext<QueryClient.Service | null>(null);

/**
 * @since 0.1.0
 * @category models
 */
export type QueryClientProviderProps = {
  readonly children?: React.ReactNode | undefined;
} & (
  | {
      /**
       * An existing registry to bind the client into and provide, instead of
       * a fresh one. Lets React and plain code share one app-wide registry.
       */
      readonly registry: AtomRegistry.AtomRegistry;
      readonly defaultIdleTTL?: never;
      readonly scheduleTask?: never;
      readonly timeoutResolution?: never;
    }
  | {
      readonly registry?: undefined;
      /** Forwarded to the `AtomRegistry`. */
      readonly defaultIdleTTL?: number | undefined;
      /** Forwarded to the `AtomRegistry`. */
      readonly scheduleTask?: ((f: () => void) => () => void) | undefined;
      /** Forwarded to the `AtomRegistry`. */
      readonly timeoutResolution?: number | undefined;
    }
) &
  (
    | { readonly client: QueryClient.Service; readonly runtime?: never }
    | {
        /** A runtime providing `QueryClient` (built synchronously). */
        readonly runtime: ManagedRuntime.ManagedRuntime<QueryClient.QueryClient, any>;
        readonly client?: never;
      }
  );

const keys = new WeakMap<QueryClient.Service, number>();
let nextKey = 0;
const keyOf = (client: QueryClient.Service): number => {
  let key = keys.get(client);
  if (key === undefined) {
    key = nextKey++;
    keys.set(client, key);
  }
  return key;
};

/**
 * Makes a `QueryClient` available to hooks and binds it to an `AtomRegistry`,
 * so query atoms work with `@effect/atom-react` hooks too
 * (`useAtomValue(todoQuery(1))`). Use this registry for your other atoms as well.
 *
 * The provider also provides `@effect/atom-react`'s `RegistryContext`, so do
 * not wrap the app in a separate `RegistryProvider`.
 *
 * ```tsx
 * const runtime = ManagedRuntime.make(QueryClient.layer().pipe(Layer.provideMerge(AppLayer)))
 * <QueryClientProvider runtime={runtime}><App /></QueryClientProvider>
 * ```
 *
 * By default the provider creates a fresh registry. Pass `registry` to bind the
 * client into an existing one instead, so code outside React (actions, the
 * HTTP layer) can share it:
 *
 * ```tsx
 * const registry = AtomRegistry.make({ scheduleTask }) // from @effect/atom-react
 * <QueryClientProvider runtime={runtime} registry={registry}><App /></QueryClientProvider>
 * ```
 *
 * The provider unbinds its client from a registry you pass when it unmounts,
 * but does not dispose either: dispose them yourself. Use one provider per
 * registry.
 *
 * @since 0.1.0
 * @category components
 */
export function QueryClientProvider(props: QueryClientProviderProps): React.ReactElement {
  const { client: clientProp, runtime, registry } = props;
  const client = React.useMemo(
    () => clientProp ?? runtime!.runSync(QueryClient.QueryClient),
    [clientProp, runtime],
  );
  useRegistryBinding(registry, client);
  return (
    <QueryClientContext.Provider value={client}>
      {registry !== undefined ? (
        <RegistryContext.Provider value={registry}>{props.children}</RegistryContext.Provider>
      ) : (
        <RegistryProvider
          key={keyOf(client)}
          initialValues={[QueryClient.initialValue(client)]}
          defaultIdleTTL={props.defaultIdleTTL}
          scheduleTask={props.scheduleTask}
          timeoutResolution={props.timeoutResolution}
        >
          {props.children}
        </RegistryProvider>
      )}
    </QueryClientContext.Provider>
  );
}

/**
 * Per shared registry: the committed provider that binds it, and the deferred
 * unbind left by the last one that unmounted. Kept per registry, not per
 * provider instance, so a provider that takes over a registry (a remount, a
 * StrictMode replay, another provider) cancels the unbind of the one before it.
 */
interface Binding {
  owner: object | undefined;
  unbind: ReturnType<typeof setTimeout> | undefined;
}
const bindings = new WeakMap<AtomRegistry.AtomRegistry, Binding>();

const bindingOf = (registry: AtomRegistry.AtomRegistry): Binding => {
  let binding = bindings.get(registry);
  if (binding === undefined) {
    binding = { owner: undefined, unbind: undefined };
    bindings.set(registry, binding);
  }
  return binding;
};

const boundClient = (registry: AtomRegistry.AtomRegistry): QueryClient.Service | undefined =>
  Option.getOrUndefined(registry.get(QueryClient.current));

/**
 * Binds `client` into a registry passed by the app, and unbinds it on unmount.
 *
 * While no committed provider owns the registry, the bind happens during
 * render, so children can read query atoms on their first render. No mounted
 * component can depend on an unowned binding, so this write notifies none.
 * If React discards that render (a suspended first mount that is then
 * removed), the client stays bound only until the next provider renders.
 * Rebinding an owned registry to another client would notify mounted
 * components, so it waits for the layout effect: until then, atom hooks see
 * the previous client for one render.
 */
const useRegistryBinding = (
  registry: AtomRegistry.AtomRegistry | undefined,
  client: QueryClient.Service,
): void => {
  if (
    registry !== undefined &&
    bindingOf(registry).owner === undefined &&
    boundClient(registry) !== client
  ) {
    registry.set(QueryClient.current, Option.some(client));
  }
  const token = React.useRef<object>({}).current;
  React.useLayoutEffect(() => {
    if (registry === undefined) return;
    const binding = bindingOf(registry);
    clearTimeout(binding.unbind);
    binding.unbind = undefined;
    if (binding.owner !== undefined && binding.owner !== token) {
      console.error(
        "Two QueryClientProviders share one AtomRegistry: query atoms in both trees use " +
          "whichever client was bound last. Give each provider its own registry.",
      );
    }
    binding.owner = token;
    if (boundClient(registry) !== client) registry.set(QueryClient.current, Option.some(client));
    return () => {
      // Another provider took the registry over: its binding stays.
      if (binding.owner !== token) return;
      binding.owner = undefined;
      // Deferred, so a StrictMode replay, a client change or a provider
      // mounting in the same commit takes the registry over first.
      binding.unbind = setTimeout(() => {
        binding.unbind = undefined;
        if (binding.owner !== undefined) return;
        bindings.delete(registry);
        try {
          if (boundClient(registry) === client) registry.set(QueryClient.current, Option.none());
        } catch {
          // The app disposed the registry before this ran (in tests, `afterEach`
          // usually disposes before testing-library unmounts). A disposed
          // registry needs no unbind, and `AtomRegistry` has no `isDisposed`.
        }
      }, 0);
    };
  }, [registry, client, token]);
};

/**
 * @since 0.1.0
 * @category errors
 */
export class MissingQueryClientProviderError extends Error {
  constructor() {
    super("No QueryClient set, use <QueryClientProvider> to set one");
    this.name = "MissingQueryClientProviderError";
  }
}

/**
 * The client of the nearest {@link QueryClientProvider}.
 *
 * @since 0.1.0
 * @category hooks
 */
export const useQueryClient = (): QueryClient.Service => {
  const client = React.useContext(QueryClientContext);
  if (client === null) throw new MissingQueryClientProviderError();
  return client;
};
