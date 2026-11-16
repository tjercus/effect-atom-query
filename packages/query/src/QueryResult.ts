/**
 * The value a query atom holds: TanStack-style status flags on top of an
 * Effect `AsyncResult`. Absent values are `Option`s, never `undefined`.
 *
 * @since 0.1.0
 */
import { Cause, type DateTime, Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { initialState, project, type QueryState } from "./internal/queryEntry.ts";

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

const none = Option.none();

const empty = {
  fetchStatus: "idle",
  isPending: false,
  isSuccess: false,
  isError: false,
  isLoading: false,
  isRefetching: false,
  isLoadingError: false,
  isRefetchError: false,
  isFetching: false,
  isPaused: false,
  isStale: false,
  isEnabled: true,
  isFetched: false,
  isFetchedAfterMount: false,
  isPlaceholderData: false,
  data: none,
  error: none,
  dataUpdatedAt: none,
  errorUpdatedAt: none,
  dataUpdateCount: 0,
  errorUpdateCount: 0,
  failureCount: 0,
  failureReason: none,
} as const;

/**
 * The value of a disabled query that has nothing in the cache, for example one
 * created with `skipToken`. The argument defaults to `AsyncResult.initial()`.
 * To mock a query disabled with `enabled: false`, use {@link idle}.
 *
 * @since 0.1.0
 * @category constructors
 */
export const disabled = <A, E = never>(
  initial: AsyncResult.AsyncResult<A, E> = AsyncResult.initial(),
): QueryResult<A, E> => ({
  ...empty,
  result: initial,
  status: "pending",
  isPending: true,
  isEnabled: false,
  data: none as Option.None<A>,
  error: none as Option.None<E>,
});

/**
 * A result built from a cache state the way real queries build theirs, with
 * the defaults of a query that just mounted: enabled, and stale (the default
 * `staleTime` is 0, and a query without data is always stale).
 */
const fromState = <A, E>(state: Partial<QueryState<A, E>>): QueryResult<A, E> =>
  project<A, E>(
    { ...initialState, ...state },
    { isStale: true, isEnabled: true, fetchedAtMount: 0 },
  );

/**
 * A query whose first load is running (`isLoading`). With the other
 * constructors, for tests and stories that mock hooks or atoms:
 *
 * ```ts
 * vi.mocked(useTodosQuery).mockReturnValue(QueryResult.success([todo]))
 * ```
 *
 * The flags match a freshly mounted query with default options. Timestamps
 * are `None`, so results are deterministic. Spread to override a flag:
 * `{ ...QueryResult.success(todos), isStale: false }`.
 *
 * @since 1.1.0
 * @category constructors
 */
export const pending = <A, E = never>(): Pending<A, E> =>
  fromState<A, E>({ fetchStatus: "fetching" }) as Pending<A, E>;

/**
 * A query that has not started and is not fetching: what a query disabled with
 * `enabled: false` returns before it has data. `isPending` is `true` but
 * `isLoading` is `false`. See {@link pending}.
 *
 * @since 1.3.0
 * @category constructors
 */
export const idle = <A, E = never>(): Pending<A, E> =>
  project<A, E>(initialState, { isStale: true, isEnabled: false, fetchedAtMount: 0 }) as Pending<
    A,
    E
  >;

/**
 * A query whose last fetch succeeded with `data`. See {@link pending}.
 *
 * @since 1.1.0
 * @category constructors
 */
export const success = <A, E = never>(data: A): Success<A, E> =>
  fromState<A, E>({
    status: "success",
    data: Option.some(data),
    dataUpdateCount: 1,
  }) as Success<A, E>;

/**
 * A query whose first fetch failed with the typed `error` (`isLoadingError`).
 * See {@link pending}.
 *
 * @since 1.1.0
 * @category constructors
 */
export const failure = <A = never, E = unknown>(error: E): Failure<A, E> =>
  fromState<A, E>({
    status: "error",
    cause: Option.some(Cause.fail(error)),
    errorUpdateCount: 1,
    failureCount: 1,
    failureReason: Option.some(error),
  }) as Failure<A, E>;

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

/**
 * Map the data of a result, keeping every flag. `result` is rebuilt to match.
 *
 * @since 0.1.0
 * @category combinators
 */
export const map = <A, E, B>(self: QueryResult<A, E>, f: (a: A) => B): QueryResult<B, E> => {
  switch (self.status) {
    case "pending":
      return self as unknown as Pending<B, E>;
    case "success": {
      const value = f(self.data.value);
      return {
        ...self,
        result: AsyncResult.success<B, E>(value, {
          waiting: self.isFetching,
          timestamp: AsyncResult.isSuccess(self.result) ? self.result.timestamp : undefined,
        }),
        data: Option.some(value) as Option.Some<B>,
        failureReason: self.failureReason,
      } as Success<B, E>;
    }
    case "error": {
      const data = Option.map(self.data, f);
      return {
        ...self,
        result: AsyncResult.failure<B, E>(self.cause, {
          previousSuccess: Option.map(data, (value) => AsyncResult.success<B, E>(value)),
          waiting: self.isFetching,
        }),
        data,
      } as Failure<B, E>;
    }
  }
};
