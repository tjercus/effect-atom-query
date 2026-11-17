import { QueryClient } from "@effect-atom-query/query";
import { Cause, Effect, Exit } from "effect";
import * as React from "react";
import { useQueryClient } from "./QueryClientProvider.tsx";

/**
 * Declares the services your app's runtime provides, so {@link useRunEffect}
 * accepts Effects that need them. Augment it once per app:
 *
 * ```ts
 * declare module "@effect-atom-query/react" {
 *   interface Register {
 *     readonly services: ApiClient | Navigation
 *   }
 * }
 * ```
 *
 * The declaration is not checked against the layer: a service listed here
 * but missing from the layer fails at run time with a defect.
 *
 * @since 1.3.0
 * @category models
 */
export interface Register {}

/**
 * The services declared in {@link Register}, or `never` without a declaration.
 *
 * @since 1.3.0
 * @category models
 */
export type RegisteredServices = Register extends { readonly services: infer S } ? S : never;

/**
 * @since 1.3.0
 * @category models
 */
export interface RunEffectOptions {
  /** Interrupts the Effect when the signal aborts. */
  readonly signal?: AbortSignal | undefined;
}

/**
 * Runs Effects in the context of the provider's `QueryClient` and returns
 * Promises, for code outside the library that expects one.
 *
 * Each method infers the whole Effect, so a union of Effects
 * (`cond ? update.mutateEffect(x) : create.mutateEffect(x)`) is accepted.
 *
 * @since 1.3.0
 * @category models
 */
export interface EffectRunner<R = RegisteredServices> {
  /**
   * Run the Effect and resolve with its `Exit`. Never rejects: success, typed
   * failure, defect and interruption are all `Exit` values. Use it for forms
   * and other code that handles the outcome.
   */
  readonly promiseExit: <X extends Effect.Effect<any, any, QueryClient.QueryClient | R>>(
    effect: X,
    options?: RunEffectOptions,
  ) => Promise<Exit.Exit<Effect.Success<X>, Effect.Error<X>>>;
  /**
   * Run the Effect and resolve with its value. Rejects with the typed error
   * itself (or the defect, or an interruption error), for route loaders and
   * other APIs that expect a rejection.
   */
  readonly promise: <X extends Effect.Effect<any, any, QueryClient.QueryClient | R>>(
    effect: X,
    options?: RunEffectOptions,
  ) => Promise<Effect.Success<X>>;
}

const makeRunner = (client: QueryClient.Service): EffectRunner<any> => {
  const promiseExit = <A, E>(
    effect: Effect.Effect<A, E, any>,
    options?: RunEffectOptions,
  ): Promise<Exit.Exit<A, E>> =>
    // Already aborted: interrupt without starting the Effect (Effect's own
    // runners would run its synchronous part first). Otherwise the client's
    // context: the services of the layer it was built in.
    client.runtime.runPromiseExit(
      options?.signal?.aborted
        ? Effect.interrupt
        : Effect.provideService(effect, QueryClient.QueryClient, client),
      options,
    );
  const promise = <A, E>(effect: Effect.Effect<A, E, any>, options?: RunEffectOptions) =>
    promiseExit(effect, options).then((exit) =>
      Exit.isSuccess(exit) ? exit.value : Promise.reject(Cause.squash(exit.cause)),
    );
  return { promiseExit, promise } as EffectRunner<any>;
};

/**
 * The one Promise boundary of the library (decision D11): a runner for
 * Effects, bound to the nearest `QueryClientProvider`'s client. It runs with
 * the services of the client's layer, plus `QueryClient`, whether the provider
 * received a `runtime` or a `client`.
 *
 * ```tsx
 * const run = useRunEffect()
 * const save = useMutation(savePost)
 * const onSubmit = async (post: Post) => {
 *   const exit = await run.promiseExit(save.mutateEffect(post)) // updates save.isPending
 *   if (Exit.isSuccess(exit)) navigate("/posts")
 * }
 * ```
 *
 * The runner is stable for the client's lifetime, so it can be passed to
 * code outside React. Declare your app's services in {@link Register}, or pass
 * them as a type argument: `useRunEffect<ApiClient>()`.
 *
 * @since 1.3.0
 * @category hooks
 */
export const useRunEffect = <R = RegisteredServices>(): EffectRunner<R> => {
  const client = useQueryClient();
  return React.useMemo(() => makeRunner(client), [client]);
};
