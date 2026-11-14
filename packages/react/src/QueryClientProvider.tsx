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

/** Which provider currently binds each shared registry, to catch two at once. */
const owners = new WeakMap<AtomRegistry.AtomRegistry, object>();

const boundClient = (registry: AtomRegistry.AtomRegistry): QueryClient.Service | undefined =>
  Option.getOrUndefined(registry.get(QueryClient.current));

/**
 * Binds `client` into a registry passed by the app, and unbinds it on unmount.
 *
 * The first bind happens during render, so children can read query atoms on
 * their first render. Nothing can depend on a client that is not there yet,
 * so this write notifies no rendered component. Rebinding to another client
 * would, so it waits for the layout effect: until then, atom hooks see the
 * previous client for one render.
 */
const useRegistryBinding = (
  registry: AtomRegistry.AtomRegistry | undefined,
  client: QueryClient.Service,
): void => {
  if (registry !== undefined && boundClient(registry) === undefined) {
    registry.set(QueryClient.current, Option.some(client));
  }
  const token = React.useRef<object>({}).current;
  const pendingUnbind = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useLayoutEffect(() => {
    if (registry === undefined) return;
    clearTimeout(pendingUnbind.current);
    const owner = owners.get(registry);
    if (owner !== undefined && owner !== token) {
      console.error(
        "Two QueryClientProviders share one AtomRegistry: query atoms in both trees use " +
          "whichever client was bound last. Give each provider its own registry.",
      );
    }
    owners.set(registry, token);
    if (boundClient(registry) !== client) registry.set(QueryClient.current, Option.some(client));
    return () => {
      if (owners.get(registry) === token) owners.delete(registry);
      // Deferred, so a StrictMode remount or a client change rebinds first.
      pendingUnbind.current = setTimeout(() => {
        if (boundClient(registry) === client) registry.set(QueryClient.current, Option.none());
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
