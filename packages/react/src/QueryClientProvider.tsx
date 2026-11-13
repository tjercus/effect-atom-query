import { QueryClient } from "@effect-native-query/query";
import { RegistryProvider } from "@effect/atom-react";
import type { ManagedRuntime } from "effect";
import * as React from "react";

const QueryClientContext = React.createContext<QueryClient.Service | null>(null);

/**
 * @since 0.1.0
 * @category models
 */
export type QueryClientProviderProps = {
  readonly children?: React.ReactNode | undefined;
  /** Forwarded to the `AtomRegistry`. */
  readonly defaultIdleTTL?: number | undefined;
  /** Forwarded to the `AtomRegistry`. */
  readonly scheduleTask?: ((f: () => void) => () => void) | undefined;
  /** Forwarded to the `AtomRegistry`. */
  readonly timeoutResolution?: number | undefined;
} & (
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
 * Makes a `QueryClient` available to hooks and binds it to a fresh
 * `AtomRegistry`, so query atoms work with `@effect/atom-react` hooks too
 * (`useAtomValue(todoQuery(1))`). Use this registry for your other atoms as well.
 *
 * ```tsx
 * const runtime = ManagedRuntime.make(QueryClient.layer().pipe(Layer.provideMerge(AppLayer)))
 * <QueryClientProvider runtime={runtime}><App /></QueryClientProvider>
 * ```
 *
 * The provider does not own the client: dispose the runtime yourself.
 *
 * @since 0.1.0
 * @category components
 */
export function QueryClientProvider(props: QueryClientProviderProps): React.ReactElement {
  const { client: clientProp, runtime } = props;
  const client = React.useMemo(
    () => clientProp ?? runtime!.runSync(QueryClient.QueryClient),
    [clientProp, runtime],
  );
  return (
    <QueryClientContext.Provider value={client}>
      <RegistryProvider
        key={keyOf(client)}
        initialValues={[QueryClient.initialValue(client)]}
        defaultIdleTTL={props.defaultIdleTTL}
        scheduleTask={props.scheduleTask}
        timeoutResolution={props.timeoutResolution}
      >
        {props.children}
      </RegistryProvider>
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
