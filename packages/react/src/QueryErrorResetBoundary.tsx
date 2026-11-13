import * as React from "react";

/**
 * @since 0.1.0
 * @category models
 */
export interface QueryErrorResetBoundaryValue {
  /** Call from an error boundary's retry: the next mount refetches instead of rethrowing. */
  readonly reset: () => void;
  readonly isReset: () => boolean;
  readonly clearReset: () => void;
}

const createValue = (): QueryErrorResetBoundaryValue => {
  let isReset = false;
  return {
    reset: () => {
      isReset = true;
    },
    isReset: () => isReset,
    clearReset: () => {
      isReset = false;
    },
  };
};

const QueryErrorResetBoundaryContext =
  React.createContext<QueryErrorResetBoundaryValue>(createValue());

/**
 * The nearest {@link QueryErrorResetBoundary} (or a shared default).
 *
 * @since 0.1.0
 * @category hooks
 */
export const useQueryErrorResetBoundary = (): QueryErrorResetBoundaryValue =>
  React.useContext(QueryErrorResetBoundaryContext);

/**
 * Scopes error resets. Queries that threw to an error boundary do not refetch
 * on remount (avoiding retry loops) until `reset()` is called, typically from
 * the error boundary's "try again" button:
 *
 * ```tsx
 * <QueryErrorResetBoundary>
 *   {({ reset }) => (
 *     <ErrorBoundary onReset={reset} fallbackRender={({ resetErrorBoundary }) => (
 *       <button onClick={resetErrorBoundary}>Try again</button>
 *     )}>
 *       <Page />
 *     </ErrorBoundary>
 *   )}
 * </QueryErrorResetBoundary>
 * ```
 *
 * @since 0.1.0
 * @category components
 */
export function QueryErrorResetBoundary(props: {
  readonly children?:
    | React.ReactNode
    | ((value: QueryErrorResetBoundaryValue) => React.ReactNode)
    | undefined;
}): React.ReactElement {
  const [value] = React.useState(createValue);
  return (
    <QueryErrorResetBoundaryContext.Provider value={value}>
      {typeof props.children === "function" ? props.children(value) : props.children}
    </QueryErrorResetBoundaryContext.Provider>
  );
}
