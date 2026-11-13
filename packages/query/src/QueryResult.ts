/**
 * The value a query atom holds: TanStack-style status flags on top of an
 * Effect `AsyncResult`. Absent values are `Option`s, never `undefined`.
 *
 * @since 0.1.0
 */
import { Cause, type DateTime, Option } from "effect";
import type { AsyncResult } from "effect/reactivity";

/**
 * Whether any data or error has arrived yet.
 *
 * @since 0.1.0
 * @category models
 */
export type Status = "pending" | "error" | "success";

/**
 * Whether a fetch is running. `paused` means a fetch wants to run but the
 * network is offline (added in phase 3).
 *
 * @since 0.1.0
 * @category models
 */
export type FetchStatus = "fetching" | "paused" | "idle";

/**
 * @since 0.1.0
 * @category models
 */
interface Base<A, E> {
  /** The source of truth, for pattern matching with `AsyncResult.builder` and friends. */
  readonly result: AsyncResult.AsyncResult<A, E>;
  readonly fetchStatus: FetchStatus;
  readonly isFetching: boolean;
  readonly isPaused: boolean;
  readonly isStale: boolean;
  readonly isEnabled: boolean;
  readonly isFetched: boolean;
  /** A fetch settled after this observer mounted (for atoms: after the atom was built). */
  readonly isFetchedAfterMount: boolean;
  readonly isPlaceholderData: boolean;
  readonly dataUpdatedAt: Option.Option<DateTime.Utc>;
  readonly errorUpdatedAt: Option.Option<DateTime.Utc>;
  readonly dataUpdateCount: number;
  readonly errorUpdateCount: number;
  /** Failed attempts of the current or last fetch. Reset to 0 on success. */
  readonly failureCount: number;
  /** The last typed failure of the current or last fetch. Cleared on success. */
  readonly failureReason: Option.Option<E>;
}

/**
 * No data and no settled error yet.
 *
 * @since 0.1.0
 * @category models
 */
export interface Pending<A, E> extends Base<A, E> {
  readonly status: "pending";
  readonly isPending: true;
  readonly isSuccess: false;
  readonly isError: false;
  /** `isPending && isFetching`: the first load is running. */
  readonly isLoading: boolean;
  readonly isRefetching: false;
  readonly isLoadingError: false;
  readonly isRefetchError: false;
  readonly data: Option.None<A>;
  readonly error: Option.None<E>;
}

/**
 * The last fetch succeeded.
 *
 * @since 0.1.0
 * @category models
 */
export interface Success<A, E> extends Base<A, E> {
  readonly status: "success";
  readonly isPending: false;
  readonly isSuccess: true;
  readonly isError: false;
  readonly isLoading: false;
  /** `isFetching && !isPending`: a background refetch is running. */
  readonly isRefetching: boolean;
  readonly isLoadingError: false;
  readonly isRefetchError: false;
  readonly data: Option.Some<A>;
  readonly error: Option.None<E>;
}

/**
 * The last fetch failed. `data` may still hold the previous successful value.
 *
 * `cause` is the full `Cause`. `error` is the typed failure, which is `None`
 * when the query died with a defect. The React bindings rethrow defects to the
 * nearest error boundary.
 *
 * @since 0.1.0
 * @category models
 */
export interface Failure<A, E> extends Base<A, E> {
  readonly status: "error";
  readonly isPending: false;
  readonly isSuccess: false;
  readonly isError: true;
  readonly isLoading: false;
  readonly isRefetching: boolean;
  /** Failed before any data arrived. */
  readonly isLoadingError: boolean;
  /** Failed while data from an earlier fetch is present. */
  readonly isRefetchError: boolean;
  readonly data: Option.Option<A>;
  readonly error: Option.Option<E>;
  readonly cause: Cause.Cause<E>;
}

/**
 * @since 0.1.0
 * @category models
 */
export type QueryResult<A, E = never> = Pending<A, E> | Success<A, E> | Failure<A, E>;

/**
 * The value of a disabled query that has nothing in the cache, for example one
 * created with `skipToken`.
 *
 * @since 0.1.0
 * @category constructors
 */
export const disabled = <A, E>(initial: AsyncResult.AsyncResult<A, E>): QueryResult<A, E> => ({
  result: initial,
  status: "pending",
  fetchStatus: "idle",
  isPending: true,
  isSuccess: false,
  isError: false,
  isLoading: false,
  isRefetching: false,
  isLoadingError: false,
  isRefetchError: false,
  isFetching: false,
  isPaused: false,
  isStale: false,
  isEnabled: false,
  isFetched: false,
  isFetchedAfterMount: false,
  isPlaceholderData: false,
  data: Option.none() as Option.None<A>,
  error: Option.none() as Option.None<E>,
  dataUpdatedAt: Option.none(),
  errorUpdatedAt: Option.none(),
  dataUpdateCount: 0,
  errorUpdateCount: 0,
  failureCount: 0,
  failureReason: Option.none(),
});

/**
 * Pattern match on the status.
 *
 * @since 0.1.0
 * @category pattern matching
 */
export const match = <A, E, X, Y, Z>(
  self: QueryResult<A, E>,
  cases: {
    readonly onPending: (r: Pending<A, E>) => X;
    readonly onSuccess: (r: Success<A, E>) => Y;
    readonly onFailure: (r: Failure<A, E>) => Z;
  },
): X | Y | Z => {
  switch (self.status) {
    case "pending":
      return cases.onPending(self);
    case "success":
      return cases.onSuccess(self);
    case "error":
      return cases.onFailure(self);
  }
};

/**
 * Whether a failed result was caused by a defect (or interruption) rather than
 * a typed error.
 *
 * @since 0.1.0
 * @category predicates
 */
export const isDefect = <A, E>(self: QueryResult<A, E>): boolean =>
  self.status === "error" && !Cause.hasFails(self.cause);
