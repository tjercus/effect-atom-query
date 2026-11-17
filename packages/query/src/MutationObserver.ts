/**
 * A framework-agnostic observer of mutation executions, one per component
 * (`useMutation`). Each `mutate` call starts a new execution in the mutation
 * cache; the observer shows the latest one.
 *
 * @since 0.1.0
 */
import { Cause, Effect, Exit, Fiber, Option } from "effect";
import type { MutationEntry } from "./internal/mutationEntry.ts";
import type * as Mutation from "./Mutation.ts";
import type * as QueryClient from "./QueryClient.ts";
import * as MutationResult from "./MutationResult.ts";

/**
 * Plain callbacks for UI side effects (toasts, navigation). They run when an
 * execution started by this observer settles, only while the observer is
 * subscribed and the execution is still its latest one. Cache work belongs in
 * the definition's Effect callbacks, which always run.
 *
 * `onError` also receives the typed failure, as in `MutationResult.error`
 * (`None` for defects):
 *
 * ```ts
 * mutate(todo, {
 *   onError: (_cause, _todo, error) => {
 *     if (Option.isSome(error) && error.value._tag === "Conflict") showConflictDialog()
 *   },
 * })
 * ```
 *
 * @since 0.1.0
 * @category models
 */
export interface Callbacks<A, E, I> {
  readonly onSuccess?: ((data: A, input: I) => void) | undefined;
  readonly onError?:
    | ((cause: Cause.Cause<E>, input: I, error: Option.Option<E>) => void)
    | undefined;
  readonly onSettled?: ((exit: Exit.Exit<A, E>, input: I) => void) | undefined;
}

/**
 * @since 0.1.0
 * @category models
 */
export class MutationObserver<I, A, E, R, C> {
  private readonly client: QueryClient.Service;
  private mutation: Mutation.MutationAtom<I, A, E, R, C>;
  private callbacks: Callbacks<A, E, I>;

  private readonly listeners = new Set<() => void>();
  private entry: MutationEntry<I, A, E, C> | undefined;
  private detachEntry: (() => void) | undefined;
  private memo:
    | { readonly state: unknown; readonly result: MutationResult.MutationResult<A, E, I, C> }
    | undefined;

  /** Bumped on every change; a cheap snapshot for `useSyncExternalStore`. */
  version = 0;

  constructor(
    client: QueryClient.Service,
    mutation: Mutation.MutationAtom<I, A, E, R, C>,
    callbacks: Callbacks<A, E, I> = {},
  ) {
    this.client = client;
    this.mutation = mutation;
    this.callbacks = callbacks;
  }

  setOptions(
    mutation: Mutation.MutationAtom<I, A, E, R, C>,
    callbacks: Callbacks<A, E, I> = {},
  ): void {
    this.mutation = mutation;
    this.callbacks = callbacks;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1 && this.entry !== undefined) {
      this.attach(this.entry);
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.detach();
      }
    };
  }

  private notify(): void {
    this.version++;
    for (const listener of Array.from(this.listeners)) {
      listener();
    }
  }

  private attach(entry: MutationEntry<I, A, E, C>): void {
    this.detach();
    const release = entry.addObserver();
    const unsubscribe = entry.subscribe(() => this.notify());
    this.detachEntry = () => {
      unsubscribe();
      release();
    };
  }

  private detach(): void {
    this.detachEntry?.();
    this.detachEntry = undefined;
  }

  private start(input: I, callbacks?: Callbacks<A, E, I>): MutationEntry<I, A, E, C> {
    const entry = this.client.mutationCache.build<I, A, E, C>(this.mutation.options, this.mutation);
    this.entry = entry;
    if (this.listeners.size > 0) {
      this.attach(entry);
    } else {
      this.detach();
    }
    // Fire UI callbacks once this execution settles, if it is still ours.
    const stop = entry.subscribe(() => {
      if (!entry.isSettled) {
        return;
      }
      stop();
      if (this.entry !== entry || this.listeners.size === 0) {
        return;
      }
      // Interrupted (back to idle): cancellations run no callbacks.
      if (entry.state.status !== "success" && entry.state.status !== "error") {
        return;
      }
      // A settled execution always has data (success) or a cause (error).
      // Without them the state is broken: the callbacks get a defect, so it
      // is not mistaken for a mutation that never settled.
      const { data, cause } = entry.state;
      const exit: Exit.Exit<A, E> =
        entry.state.status === "success" && Option.isSome(data)
          ? Exit.succeed(data.value)
          : Exit.failCause(
              Option.getOrElse(cause, () => Cause.die("mutation settled without data or a cause")),
            );
      const error = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : Option.none();
      for (const cb of [this.callbacks, callbacks]) {
        if (cb === undefined) {
          continue;
        }
        if (Exit.isSuccess(exit)) {
          cb.onSuccess?.(exit.value, input);
        } else {
          cb.onError?.(exit.cause, input, error);
        }
        cb.onSettled?.(exit, input);
      }
    });
    this.notify();
    return entry;
  }

  /** Fire and forget. Requires the mutation's services in the client's context. */
  mutate(input: I, callbacks?: Callbacks<A, E, I>): void {
    this.start(input, callbacks).execute(input);
  }

  /** Run the mutation as an Effect (with the caller's services) and wait for it. */
  mutateEffect(input: I): Effect.Effect<A, E, R> {
    return Effect.contextWith((context) => Fiber.join(this.start(input).execute(input, context)));
  }

  /** Forget the latest execution (it keeps running in the cache). */
  reset(): void {
    this.detach();
    this.entry = undefined;
    this.notify();
  }

  getCurrentResult(): MutationResult.MutationResult<A, E, I, C> {
    const state = this.entry?.state;
    if (this.memo !== undefined && this.memo.state === state) {
      return this.memo.result;
    }
    const result =
      state === undefined ? MutationResult.idle<A, E, I, C>() : MutationResult.project(state);
    this.memo = { state, result };
    return result;
  }
}

/**
 * @since 0.1.0
 * @category constructors
 */
export const make = <I, A, E, R, C>(
  client: QueryClient.Service,
  mutation: Mutation.MutationAtom<I, A, E, R, C>,
  callbacks?: Callbacks<A, E, I>,
): MutationObserver<I, A, E, R, C> => new MutationObserver(client, mutation, callbacks);
