/**
 * @effect-native-query/react: React bindings for @effect-native-query/query.
 *
 * @since 0.1.0
 */

export {
  FocusManager,
  OnlineManager,
  Query,
  QueryClient,
  QueryKey,
  QueryObserver,
  QueryResult,
} from "@effect-native-query/query";

/** @since 0.1.0 */
export {
  MissingQueryClientProviderError,
  QueryClientProvider,
  type QueryClientProviderProps,
  useQueryClient,
} from "./QueryClientProvider.tsx";

/** @since 0.1.0 */
export { useIsFetching } from "./useIsFetching.ts";

/** @since 0.1.0 */
export {
  type QueriesEntry,
  type QueriesInput,
  type QueriesResults,
  queriesEntry,
  useQueries,
} from "./useQueries.ts";

/** @since 0.1.0 */
export {
  type DefinedUseQueryResult,
  type UseQueryOptions,
  type UseQueryResult,
  useQuery,
} from "./useQuery.ts";
