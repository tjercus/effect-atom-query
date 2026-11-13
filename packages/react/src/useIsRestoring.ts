import * as React from "react";
import { useQueryClient } from "./QueryClientProvider.tsx";

/**
 * Whether a `QueryPersister` with `restore: "background"` is still restoring
 * the cache. Queries do not fetch on mount meanwhile; Suspense hooks suspend.
 *
 * @since 0.1.0
 * @category hooks
 */
export const useIsRestoring = (): boolean => {
  const client = useQueryClient();
  const restoring = client.runtime.restoring;
  return React.useSyncExternalStore(
    React.useCallback((onStoreChange) => restoring.subscribe(onStoreChange), [restoring]),
    restoring.isRestoring,
    restoring.isRestoring,
  );
};
