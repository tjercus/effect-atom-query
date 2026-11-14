import {
  type MutationResult,
  MutationResult as MR,
  type QueryClient,
} from "@effect-atom-query/query";
import * as React from "react";
import { useQueryClient } from "./QueryClientProvider.tsx";

/**
 * The state of every matching mutation execution in the cache, e.g. the
 * `variables` of pending ones for optimistic UIs:
 *
 * ```tsx
 * const pendingTitles = useMutationState({
 *   filters: { mutation: addTodo, status: "pending" },
 *   select: (m) => m.variables,
 * })
 * ```
 *
 * @since 0.1.0
 * @category hooks
 */
export const useMutationState = <
  T = MutationResult.MutationResult<unknown, unknown, unknown, unknown>,
>(
  options: {
    readonly filters?: QueryClient.MutationFilters | undefined;
    readonly select?:
      | ((mutation: MutationResult.MutationResult<any, any, any, any>) => T)
      | undefined;
  } = {},
): ReadonlyArray<T> => {
  const client = useQueryClient();
  const cache = React.useRef<{
    states: ReadonlyArray<unknown>;
    select: unknown;
    value: ReadonlyArray<T>;
  } | null>(null);

  const getSnapshot = (): ReadonlyArray<T> => {
    const entries = client.mutationCache.findAll(options.filters);
    const states = entries.map((entry) => entry.state);
    const previous = cache.current;
    if (
      previous !== null &&
      previous.select === options.select &&
      previous.states.length === states.length &&
      previous.states.every((s, i) => s === states[i])
    ) {
      return previous.value;
    }
    const value = entries.map((entry) => {
      const result = MR.project(entry.state);
      return options.select ? options.select(result) : (result as unknown as T);
    });
    cache.current = { states, select: options.select, value };
    return value;
  };

  return React.useSyncExternalStore(
    React.useCallback((onStoreChange) => client.mutationCache.subscribe(onStoreChange), [client]),
    getSnapshot,
    getSnapshot,
  );
};

/**
 * The number of matching mutations that are pending.
 *
 * @since 0.1.0
 * @category hooks
 */
export const useIsMutating = (filters?: QueryClient.MutationFilters): number => {
  const client = useQueryClient();
  const getSnapshot = () => client.mutationCache.findAll({ ...filters, status: "pending" }).length;
  return React.useSyncExternalStore(
    React.useCallback((onStoreChange) => client.mutationCache.subscribe(onStoreChange), [client]),
    getSnapshot,
    getSnapshot,
  );
};
