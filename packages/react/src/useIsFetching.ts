import type { QueryClient } from "@effect-atom-query/query";
import * as React from "react";
import { useQueryClient } from "./QueryClientProvider.tsx";

/**
 * The number of matching queries that are fetching (for global loading
 * indicators).
 *
 * @since 0.1.0
 * @category hooks
 */
export const useIsFetching = (filters?: QueryClient.QueryFilters): number => {
  const client = useQueryClient();
  const getSnapshot = () =>
    client.cache.findAll(filters).filter((entry) => entry.isFetching).length;
  return React.useSyncExternalStore(
    React.useCallback((onStoreChange) => client.cache.subscribe(onStoreChange), [client]),
    getSnapshot,
    getSnapshot,
  );
};
