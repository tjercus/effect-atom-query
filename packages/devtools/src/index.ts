/**
 * @effect-atom-query/devtools: an in-app inspector for the query and
 * mutation caches.
 *
 * ```tsx
 * <QueryClientProvider runtime={runtime}>
 *   <App />
 *   <QueryDevtools />
 * </QueryClientProvider>
 * ```
 *
 * Both components render nothing when `process.env.NODE_ENV` is
 * `"production"`, so bundlers drop the panel from production builds.
 *
 * @since 0.1.0
 */
import type * as React from "react";
import {
  QueryDevtoolsImpl,
  QueryDevtoolsPanelImpl,
  type QueryDevtoolsPanelProps,
  type QueryDevtoolsProps,
} from "./QueryDevtools.tsx";

export type { QueryDevtoolsPanelProps, QueryDevtoolsProps } from "./QueryDevtools.tsx";

declare const process: { readonly env: { readonly NODE_ENV?: string | undefined } };

// Kept as a plain `process.env.NODE_ENV` comparison so bundlers can replace it
// and drop the panel from production builds (the size budget checks this).
// Without a bundler (native ESM), define `process.env.NODE_ENV` yourself.
const isProduction = process.env.NODE_ENV === "production";

const Nothing = (): null => null;

/**
 * A floating button that opens the devtools panel.
 *
 * @since 0.1.0
 * @category components
 */
export const QueryDevtools: (props: QueryDevtoolsProps) => React.ReactNode = isProduction
  ? Nothing
  : QueryDevtoolsImpl;

/**
 * The devtools panel on its own, for embedding.
 *
 * @since 0.1.0
 * @category components
 */
export const QueryDevtoolsPanel: (props: QueryDevtoolsPanelProps) => React.ReactNode = isProduction
  ? Nothing
  : QueryDevtoolsPanelImpl;
