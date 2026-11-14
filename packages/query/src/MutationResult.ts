/**
 * The state of a mutation as observers see it: TanStack-style flags on top of
 * an Effect `AsyncResult`, with `Option`s instead of `undefined`.
 *
 * @since 0.1.0
 */
import { Cause, DateTime, Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import type { MutationState } from "./internal/mutationEntry.ts";

/**
 * @since 0.1.0
 * @category models
 */
export type Status = "idle" | "pending" | "success" | "error";

interface Base<A, E, I, C> {
  /** `Initial` while idle, `waiting` while pending. */
  readonly result: AsyncResult.AsyncResult<A, E>;
  readonly variables: Option.Option<I>;
  /** What `onMutate` returned. */
  readonly context: Option.Option<C>;
  readonly failureCount: number;
  readonly failureReason: Option.Option<E>;
  /** Waiting for the network, or for an earlier mutation of the same scope. */
  readonly isPaused: boolean;
  readonly submittedAt: Option.Option<DateTime.Utc>;
}

/**
 * @since 0.1.0
 * @category models
 */
export interface Idle<A, E, I, C> extends Base<A, E, I, C> {
  readonly status: "idle";
  readonly isIdle: true;
  readonly isPending: false;
  readonly isSuccess: false;
  readonly isError: false;
  readonly data: Option.None<A>;
  readonly error: Option.None<E>;
}

/**
 * @since 0.1.0
 * @category models
 */
export interface Pending<A, E, I, C> extends Base<A, E, I, C> {
  readonly status: "pending";
  readonly isIdle: false;
  readonly isPending: true;
  readonly isSuccess: false;
  readonly isError: false;
  readonly variables: Option.Some<I>;
  readonly data: Option.None<A>;
  readonly error: Option.None<E>;
}

/**
 * @since 0.1.0
 * @category models
 */
export interface Success<A, E, I, C> extends Base<A, E, I, C> {
  readonly status: "success";
  readonly isIdle: false;
  readonly isPending: false;
  readonly isSuccess: true;
  readonly isError: false;
  readonly variables: Option.Some<I>;
  readonly data: Option.Some<A>;
  readonly error: Option.None<E>;
}

/**
 * `error` is the typed failure (`None` for defects); `cause` is the full `Cause`.
 *
 * @since 0.1.0
 * @category models
 */
export interface Failure<A, E, I, C> extends Base<A, E, I, C> {
  readonly status: "error";
  readonly isIdle: false;
  readonly isPending: false;
  readonly isSuccess: false;
  readonly isError: true;
  readonly variables: Option.Some<I>;
  readonly data: Option.None<A>;
  readonly error: Option.Option<E>;
  readonly cause: Cause.Cause<E>;
}

/**
 * @since 0.1.0
 * @category models
 */
export type MutationResult<A, E = never, I = void, C = unknown> =
  | Idle<A, E, I, C>
  | Pending<A, E, I, C>
  | Success<A, E, I, C>
  | Failure<A, E, I, C>;

/**
 * @since 0.1.0
 * @category predicates
 */
export const isDefect = <A, E, I, C>(self: MutationResult<A, E, I, C>): boolean =>
  self.status === "error" && !Cause.hasFails(self.cause);

/** @internal */
export const project = <I, A, E, C>(
  state: MutationState<I, A, E, C>,
): MutationResult<A, E, I, C> => {
  const base = {
    variables: state.variables,
    context: state.context,
    failureCount: state.failureCount,
    failureReason: state.failureReason,
    isPaused: state.isPaused,
    submittedAt:
      state.submittedAt === 0 ? Option.none() : Option.some(DateTime.makeUnsafe(state.submittedAt)),
  };
  const flags = { isIdle: false, isPending: false, isSuccess: false, isError: false } as const;
  const none = Option.none();
  switch (state.status) {
    case "idle":
      return {
        ...base,
        ...flags,
        status: "idle",
        isIdle: true,
        result: AsyncResult.initial(),
        data: none as Option.None<A>,
        error: none as Option.None<E>,
      };
    case "pending":
      return {
        ...base,
        ...flags,
        status: "pending",
        isPending: true,
        result: AsyncResult.initial(true),
        variables: state.variables as Option.Some<I>,
        data: none as Option.None<A>,
        error: none as Option.None<E>,
      };
    case "success":
      return {
        ...base,
        ...flags,
        status: "success",
        isSuccess: true,
        result: AsyncResult.success(Option.getOrThrow(state.data)),
        variables: state.variables as Option.Some<I>,
        data: state.data as Option.Some<A>,
        error: none as Option.None<E>,
      };
    case "error": {
      const cause = Option.getOrElse(
        state.cause,
        () => Cause.die("unknown mutation failure") as Cause.Cause<E>,
      );
      return {
        ...base,
        ...flags,
        status: "error",
        isError: true,
        result: AsyncResult.failure(cause),
        variables: state.variables as Option.Some<I>,
        data: none as Option.None<A>,
        error: Cause.findErrorOption(cause),
        cause,
      };
    }
  }
};

/** @internal */
export const idle = <A, E, I, C>(): MutationResult<A, E, I, C> =>
  project<I, A, E, C>({
    status: "idle",
    data: Option.none(),
    cause: Option.none(),
    variables: Option.none(),
    context: Option.none(),
    failureCount: 0,
    failureReason: Option.none(),
    isPaused: false,
    submittedAt: 0,
    ranAt: 0,
  });
