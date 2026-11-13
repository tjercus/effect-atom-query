import { type Mutation, MutationObserver, MutationResult } from "@effect-native-query/query";
import { Cause, type Effect, Option } from "effect";
import * as React from "react";
import { useQueryClient } from "./QueryClientProvider.tsx";
import type { ThrowOnError } from "./useQuery.ts";

/**
 * @since 0.1.0
 * @category models
 */
export interface UseMutationOptions<A, E, I> extends MutationObserver.Callbacks<A, E, I> {
  /** Throw typed errors to the nearest error boundary. Defects are always thrown. */
  readonly throwOnError?: boolean | ThrowOnError<E> | undefined;
}

/**
 * `mutate` takes no input for `void` mutations.
 *
 * @since 0.1.0
 * @category models
 */
export type Mutate<A, E, I> = [I] extends [void]
  ? (input?: I, callbacks?: MutationObserver.Callbacks<A, E, I>) => void
  : (input: I, callbacks?: MutationObserver.Callbacks<A, E, I>) => void;

/**
 * @since 0.1.0
 * @category models
 */
export type MutateEffect<A, E, R, I> = [I] extends [void]
  ? (input?: I) => Effect.Effect<A, E, R>
  : (input: I) => Effect.Effect<A, E, R>;

/**
 * @since 0.1.0
 * @category models
 */
export type UseMutationResult<A, E, I, C, R> = MutationResult.MutationResult<A, E, I, C> & {
  /** Fire and forget. The mutation's services must be in the client's context. */
  readonly mutate: Mutate<A, E, I>;
  /** Run and await as an Effect, with the caller's services (decision D4: no Promise API). */
  readonly mutateEffect: MutateEffect<A, E, R, I>;
  /** Forget the latest execution (it keeps running in the cache). */
  readonly reset: () => void;
};

/**
 * Run a mutation from a component. State is per component: the latest
 * execution started here. `onSuccess` / `onError` / `onSettled` here are UI
 * callbacks for executions started by this component, while mounted.
 *
 * ```tsx
 * const add = useMutation(addTodo, { onSuccess: () => setTitle("") })
 * <button disabled={add.isPending} onClick={() => add.mutate(title)}>Add</button>
 * ```
 *
 * @since 0.1.0
 * @category hooks
 */
export const useMutation = <I, A, E, R, C>(
  mutation: Mutation.MutationAtom<I, A, E, R, C>,
  options: UseMutationOptions<NoInfer<A>, NoInfer<E>, NoInfer<I>> = {},
): UseMutationResult<A, E, I, C, R> => {
  const client = useQueryClient();
  const observer = React.useMemo(
    () => MutationObserver.make(client, mutation, options),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client],
  );
  React.useSyncExternalStore(
    React.useCallback((onStoreChange) => observer.subscribe(onStoreChange), [observer]),
    () => observer.version,
    () => observer.version,
  );
  React.useEffect(() => {
    observer.setOptions(mutation, options);
  });

  const result = observer.getCurrentResult();
  if (result.status === "error") {
    if (MutationResult.isDefect(result)) throw Cause.squash(result.cause);
    const { throwOnError } = options;
    if (Option.isSome(result.error)) {
      const error = result.error.value;
      if (typeof throwOnError === "function" ? throwOnError(error) : throwOnError === true)
        throw error;
    }
  }

  const mutate = React.useCallback(
    (input?: I, callbacks?: MutationObserver.Callbacks<A, E, I>) =>
      observer.mutate(input as I, callbacks),
    [observer],
  );
  const mutateEffect = React.useCallback(
    (input?: I) => observer.mutateEffect(input as I),
    [observer],
  );
  const reset = React.useCallback(() => observer.reset(), [observer]);
  return React.useMemo(
    () =>
      ({ ...result, mutate, mutateEffect, reset }) as unknown as UseMutationResult<A, E, I, C, R>,
    [result, mutate, mutateEffect, reset],
  );
};
