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
 * The provider does not own the client or a registry you pass: dispose them
 * yourself.
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
  // Bind during render (idempotent), so children can read query atoms on
  // their first render.
  if (registry !== undefined) {
    const bound = registry.get(QueryClient.current);
    if (Option.isNone(bound) || bound.value !== client) {
      registry.set(QueryClient.current, Option.some(client));
    }
  }
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
