/**
 * @effect-atom-query/react: React bindings for @effect-atom-query/query.
 *
 * @since 0.1.0
 */

export {
  FocusManager,
  InfiniteQuery,
  QueryPersister,
  Mutation,
  MutationObserver,
  MutationResult,
  OnlineManager,
  Query,
  QueryClient,
  QueryKey,
  QueryObserver,
  QueryResult,
} from "@effect-atom-query/query";

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
export { useIsRestoring } from "./useIsRestoring.ts";

/** @since 0.1.0 */
export {
  type Mutate,
  type MutateEffect,
  type UseMutationOptions,
  type UseMutationResult,
  useMutation,
} from "./useMutation.ts";

/** @since 0.1.0 */
export { useIsMutating, useMutationState } from "./useMutationState.ts";

/** @since 0.1.0 */
export {
  type QueriesEntry,
  type QueriesInput,
  type QueriesResults,
  type SuspenseQueriesResults,
  queriesEntry,
  useQueries,
  useSuspenseQueries,
} from "./useQueries.ts";

/** @since 0.1.0 */
export {
  QueryErrorResetBoundary,
  type QueryErrorResetBoundaryValue,
  useQueryErrorResetBoundary,
} from "./QueryErrorResetBoundary.tsx";

/** @since 0.1.0 */
export {
  type UseInfiniteQueryResult,
  type UseSuspenseInfiniteQueryResult,
  useInfiniteQuery,
  useSuspenseInfiniteQuery,
} from "./useInfiniteQuery.ts";

/** @since 0.1.0 */
export { usePrefetchInfiniteQuery, usePrefetchQuery } from "./usePrefetchQuery.ts";

/** @since 0.1.0 */
export {
  type DefinedUseQueryResult,
  type NotifyOnChangeProps,
  type UseQueryOptions,
  type UseQueryResult,
  type UseSuspenseQueryOptions,
  useQuery,
  useSuspenseQuery,
} from "./useQuery.ts";
