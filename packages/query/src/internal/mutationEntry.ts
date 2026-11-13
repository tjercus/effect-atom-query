/**
 * One mutation execution (one `mutate` call). Internal.
 */
import type { Schema } from "effect";
import {
  Cause,
  type Context,
  Duration,
  Effect,
  Exit,
  type Fiber,
  Option,
  type Semaphore,
} from "effect";
import type * as QueryKey from "../QueryKey.ts";
import type * as MutationResult from "../MutationResult.ts";
import {
  type ClientRuntime,
  type NetworkMode,
  type ReactivityKeys,
  type RetryOption,
  resolveRetry,
} from "./queryEntry.ts";

/** @internal */
export type MutationKey = ReadonlyArray<unknown>;

/**
 * The options of a mutation definition (and of `setMutationDefaults`).
 * Callbacks are Effects; they run inside the mutation, with the client's
 * services and the `QueryClient` available.
 * @internal
 */
export interface MutationOptions<I, A, E, R, C> {
  readonly key?: MutationKey | undefined;
  readonly run?: ((input: I) => Effect.Effect<A, E, R>) | undefined;
  /** Runs before `run`; its result is the `context` passed to the other callbacks (e.g. a rollback snapshot). */
  readonly onMutate?: ((input: I) => Effect.Effect<C, never, any>) | undefined;
  readonly onSuccess?:
    | ((data: A, input: I, context: Option.Option<C>) => Effect.Effect<unknown, never, any>)
    | undefined;
  readonly onError?:
    | ((
        cause: Cause.Cause<E>,
        input: I,
        context: Option.Option<C>,
      ) => Effect.Effect<unknown, never, any>)
    | undefined;
  readonly onSettled?:
    | ((
        exit: Exit.Exit<A, E>,
        input: I,
        context: Option.Option<C>,
      ) => Effect.Effect<unknown, never, any>)
    | undefined;
  /**
   * Query keys (prefix match) to invalidate after success. The mutation
   * settles once active matching queries have refetched.
   */
  readonly invalidates?:
    | ReadonlyArray<QueryKey.QueryKey>
    | ((data: A, input: I) => ReadonlyArray<QueryKey.QueryKey>)
    | undefined;
  /** Keys to invalidate in Effect's `Reactivity` service after success. */
  readonly reactivityKeys?: ReactivityKeys | ((data: A, input: I) => ReactivityKeys) | undefined;
  /** Defaults to no retries. */
  readonly retry?: RetryOption<E> | undefined;
  readonly networkMode?: NetworkMode | undefined;
  /** Mutations with the same scope id run one after another. */
  readonly scope?: string | ((input: I) => string) | undefined;
  readonly gcTime?: Duration.Input | undefined;
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
  /**
   * Persist this mutation while it is paused offline (`QueryPersister`), so it
   * can be resumed after a reload. Requires a `key`, and a `run` registered
   * with `setMutationDefaults` for that key, since functions cannot be stored.
   */
  readonly persist?: { readonly variables: Schema.Codec<I, any> } | undefined;
}

/** @internal */
export interface MutationState<I, A, E, C> {
  readonly status: MutationResult.Status;
  readonly data: Option.Option<A>;
  readonly cause: Option.Option<Cause.Cause<E>>;
  readonly variables: Option.Option<I>;
  readonly context: Option.Option<C>;
  readonly failureCount: number;
  readonly failureReason: Option.Option<E>;
  readonly isPaused: boolean;
  /** epoch millis; 0 = not submitted */
  readonly submittedAt: number;
}

/** @internal */
export const idleState: MutationState<never, never, never, never> = {
  status: "idle",
  data: Option.none(),
  cause: Option.none(),
  variables: Option.none(),
  context: Option.none(),
  failureCount: 0,
  failureReason: Option.none(),
  isPaused: false,
  submittedAt: 0,
};

/** What a mutation entry needs from its cache/client. @internal */
export interface MutationRuntime {
  readonly client: ClientRuntime;
  readonly scope: (id: string) => { readonly semaphore: Semaphore.Semaphore; running: number };
  readonly invalidate: (keys: ReadonlyArray<QueryKey.QueryKey>) => Effect.Effect<void>;
  readonly onChange: () => void;
  readonly remove: (entry: MutationEntry<any, any, any, any>) => void;
}

let nextId = 0;

/** @internal */
export class MutationEntry<I, A, E, C> {
  readonly id = nextId++;
  readonly options: MutationOptions<I, A, E, any, C>;
  /** The mutation atom this execution came from, for filters. */
  readonly source: unknown;
  state: MutationState<I, A, E, C> = idleState;
  observers = 0;

  private readonly listeners = new Set<() => void>();
  private readonly runtime: MutationRuntime;
  private fiber: Fiber.Fiber<A, E> | undefined;
  private gcFiber: Fiber.Fiber<void> | undefined;
  private removed = false;
  /** Restored from storage and waiting for `resumePausedMutations`. */
  private awaitingResume = false;

  constructor(
    options: MutationOptions<I, A, E, any, C>,
    runtime: MutationRuntime,
    source?: unknown,
  ) {
    this.options = options;
    this.source = source;
    this.runtime = runtime;
  }

  get key(): MutationKey | undefined {
    return this.options.key;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  addObserver(): () => void {
    this.observers++;
    this.cancelGc();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.observers--;
      if (this.observers === 0 && this.isSettled) this.scheduleGc();
    };
  }

  get isSettled(): boolean {
    return this.state.status === "success" || this.state.status === "error";
  }

  private setState(f: (s: MutationState<I, A, E, C>) => MutationState<I, A, E, C>): void {
    this.state = f(this.state);
    for (const listener of Array.from(this.listeners)) listener();
    this.runtime.onChange();
  }

  /** Seed a restored, paused execution; it runs on {@link resume}. */
  restore(variables: I, submittedAt: number): void {
    this.awaitingResume = true;
    this.setState(() => ({
      ...idleState,
      status: "pending",
      variables: Option.some(variables),
      submittedAt,
      isPaused: true,
    }));
  }

  get isAwaitingResume(): boolean {
    return this.awaitingResume;
  }

  /** Run a restored execution with its stored variables. */
  resume(): Fiber.Fiber<A, E> | undefined {
    if (!this.awaitingResume || Option.isNone(this.state.variables)) return this.fiber;
    this.awaitingResume = false;
    return this.execute(this.state.variables.value);
  }

  /** Start executing. Returns the fiber settling with the mutation's outcome. */
  execute(input: I, context?: Context.Context<any>): Fiber.Fiber<A, E> {
    if (this.fiber !== undefined) return this.fiber;
    this.fiber = this.runtime.client.runFork(this.program(input), context);
    return this.fiber;
  }

  private program(input: I): Effect.Effect<A, E, any> {
    const options = this.options;
    const run = options.run;
    return Effect.gen({ self: this }, function* () {
      this.setState(() => ({
        ...idleState,
        status: "pending",
        variables: Option.some(input),
        submittedAt: this.runtime.client.now(),
      }));
      if (run === undefined) {
        return yield* Effect.die(
          new Error(`Mutation ${JSON.stringify(options.key)} has no \`run\``),
        );
      }

      const context: Option.Option<C> = options.onMutate
        ? Option.some(yield* options.onMutate(input))
        : Option.none();
      if (Option.isSome(context)) this.setState((s) => ({ ...s, context }));

      const exit = yield* Effect.exit(this.runScoped(input, run));

      if (Exit.isSuccess(exit)) {
        const data = exit.value;
        if (options.onSuccess) yield* options.onSuccess(data, input, context);
        const keys =
          typeof options.invalidates === "function"
            ? options.invalidates(data, input)
            : options.invalidates;
        if (keys !== undefined && keys.length > 0) yield* this.runtime.invalidate(keys);
        const reactivityKeys =
          typeof options.reactivityKeys === "function"
            ? options.reactivityKeys(data, input)
            : options.reactivityKeys;
        if (reactivityKeys !== undefined)
          this.runtime.client.reactivity?.invalidateUnsafe(reactivityKeys);
      } else if (!Cause.hasInterruptsOnly(exit.cause)) {
        if (options.onError) yield* options.onError(exit.cause, input, context);
      }
      if (options.onSettled) yield* options.onSettled(exit, input, context);
      return yield* exit;
    }).pipe(Effect.onExit((exit) => Effect.sync(() => this.onExit(exit))));
  }

  /** `run` with retries, offline pausing, and scope serialisation. */
  private runScoped(
    input: I,
    run: (input: I) => Effect.Effect<A, E, any>,
  ): Effect.Effect<A, E, any> {
    const networkMode = this.options.networkMode ?? "online";
    let attempt = 0;
    const once = Effect.suspend(() => {
      const n = attempt++;
      const pause = networkMode === "online" || (networkMode === "offlineFirst" && n > 0);
      return pause ? Effect.andThen(this.pauseWhileOffline(), run(input)) : run(input);
    }).pipe(
      Effect.tapError((error) =>
        Effect.sync(() =>
          this.setState((s) => ({
            ...s,
            failureCount: s.failureCount + 1,
            failureReason: Option.some(error),
          })),
        ),
      ),
    );
    const retry = resolveRetry(this.options.retry ?? false);
    const withRetry = Option.isSome(retry) ? once.pipe(Effect.retry(retry.value)) : once;

    const scopeOption = this.options.scope;
    const scopeId = typeof scopeOption === "function" ? scopeOption(input) : scopeOption;
    if (scopeId === undefined) return withRetry;
    const scope = this.runtime.scope(scopeId);
    return Effect.suspend(() => {
      // Queued behind another mutation of the same scope: show as paused.
      if (scope.running > 0) this.setState((s) => ({ ...s, isPaused: true }));
      scope.running++;
      return scope.semaphore.withPermit(
        Effect.andThen(
          Effect.sync(() => {
            if (this.state.isPaused) this.setState((s) => ({ ...s, isPaused: false }));
          }),
          withRetry,
        ),
      );
    }).pipe(Effect.ensuring(Effect.sync(() => scope.running--)));
  }

  private pauseWhileOffline(): Effect.Effect<void> {
    const online = this.runtime.client.online;
    return Effect.suspend(() => {
      if (online.isOnline()) return Effect.void;
      this.setState((s) => ({ ...s, isPaused: true }));
      return Effect.callback<void>((resume) => {
        const unsubscribe = online.subscribe((isOnline) => {
          if (!isOnline) return;
          unsubscribe();
          resume(Effect.void);
        });
        return Effect.sync(unsubscribe);
      }).pipe(Effect.andThen(Effect.sync(() => this.setState((s) => ({ ...s, isPaused: false })))));
    });
  }

  private onExit(exit: Exit.Exit<A, E>): void {
    this.fiber = undefined;
    if (this.removed) return;
    if (Exit.isSuccess(exit)) {
      this.setState((s) => ({
        ...s,
        status: "success",
        data: Option.some(exit.value),
        cause: Option.none(),
        failureReason: Option.none(),
        isPaused: false,
      }));
    } else {
      this.setState((s) => ({
        ...s,
        status: "error",
        cause: Option.some(exit.cause),
        isPaused: false,
      }));
    }
    if (this.observers === 0) this.scheduleGc();
  }

  private scheduleGc(): void {
    this.cancelGc();
    const gcTime = Duration.fromInputUnsafe(this.options.gcTime ?? "5 minutes");
    if (this.removed || !Duration.isFinite(gcTime)) return;
    this.gcFiber = this.runtime.client.runFork(
      Effect.sleep(gcTime).pipe(
        Effect.andThen(
          Effect.sync(() => {
            this.gcFiber = undefined;
            if (this.observers === 0 && this.isSettled) this.runtime.remove(this);
          }),
        ),
      ),
    );
  }

  private cancelGc(): void {
    this.gcFiber?.interruptUnsafe();
    this.gcFiber = undefined;
  }

  get isRemoved(): boolean {
    return this.removed;
  }

  dispose(): void {
    if (this.removed) return;
    this.removed = true;
    this.cancelGc();
    this.fiber?.interruptUnsafe();
    for (const listener of Array.from(this.listeners)) listener();
  }
}
