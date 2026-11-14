/**
 * Mutation definitions.
 *
 * ```ts
 * const addTodo = Mutation.make({
 *   key: ["todos", "add"],
 *   run: (title: string) => TodoRepo.use((repo) => repo.add(title)),
 *   invalidates: [["todos"]],
 * })
 *
 * registry.set(addTodo, "buy milk")   // run it; the atom holds the latest MutationResult
 * client.mutate(addTodo, "buy milk")  // Effect<Todo, TodoError, TodoRepo>
 * useMutation(addTodo)                // per-component state, mutate / mutateEffect
 * ```
 *
 * @since 0.1.0
 */
import { type Cause, type Effect, type Exit, Option } from "effect";
import { Atom } from "effect/reactivity";
import type { MutationEntry, MutationKey, MutationOptions } from "./internal/mutationEntry.ts";
import type { ReactivityKeys } from "./internal/queryEntry.ts";
import type * as Query from "./Query.ts";
import * as QueryClient from "./QueryClient.ts";
import * as QueryKey from "./QueryKey.ts";
import * as MutationResult from "./MutationResult.ts";
import * as QueryResult from "./QueryResult.ts";

export type { MutationKey } from "./internal/mutationEntry.ts";

/**
 * @since 0.1.0
 * @category symbols
 */
export const TypeId: TypeId = "~@effect-atom-query/query/Mutation";

/**
 * @since 0.1.0
 * @category symbols
 */
export type TypeId = "~@effect-atom-query/query/Mutation";

/**
 * A mutation definition. Callbacks are Effects that run inside the mutation
 * with the client's services and the `QueryClient` available, so optimistic
 * updates are plain Effect code:
 *
 * ```ts
 * onMutate: (title) => Effect.gen(function* () {
 *   const client = yield* QueryClient.QueryClient
 *   yield* client.cancelQueries({ queryKey: ["todos"] })
 *   const previous = yield* client.getQueryData(todosQuery)
 *   yield* client.setQueryData(todosQuery, (todos) => Option.map(todos, (t) => [...t, { title }]))
 *   return previous
 * }),
 * onError: (_cause, _title, previous) =>
 *   QueryClient.QueryClient.pipe(Effect.flatMap((client) =>
 *     client.setQueryData(todosQuery, () => Option.flatten(previous)))),
 * ```
 *
 * @since 0.1.0
 * @category models
 */
export interface Definition<I, A, E, R, C> {
  readonly key?: MutationKey | undefined;
  readonly run: (input: I) => Effect.Effect<A, E, R>;
  /** Runs before `run`; its result is the `context` of the other callbacks (e.g. a rollback snapshot). */
  readonly onMutate?:
    | ((input: I) => Effect.Effect<C, never, R | QueryClient.QueryClient>)
    | undefined;
  readonly onSuccess?:
    | ((
        data: A,
        input: I,
        context: Option.Option<C>,
      ) => Effect.Effect<unknown, never, R | QueryClient.QueryClient>)
    | undefined;
  readonly onError?:
    | ((
        cause: Cause.Cause<E>,
        input: I,
        context: Option.Option<C>,
      ) => Effect.Effect<unknown, never, R | QueryClient.QueryClient>)
    | undefined;
  readonly onSettled?:
    | ((
        exit: Exit.Exit<A, E>,
        input: I,
        context: Option.Option<C>,
      ) => Effect.Effect<unknown, never, R | QueryClient.QueryClient>)
    | undefined;
  /**
   * Query keys (prefix match) to invalidate after success. The mutation stays
   * pending until the active matching queries have refetched, so UIs never
   * flash stale data.
   */
  readonly invalidates?:
    | ReadonlyArray<QueryKey.QueryKey>
    | ((data: A, input: I) => ReadonlyArray<QueryKey.QueryKey>)
    | undefined;
  /** Keys to invalidate in Effect's `Reactivity` service after success. */
  readonly reactivityKeys?: ReactivityKeys | ((data: A, input: I) => ReactivityKeys) | undefined;
  /** Defaults to no retries. */
  readonly retry?: MutationOptions<I, A, E, R, C>["retry"];
  readonly networkMode?: MutationOptions<I, A, E, R, C>["networkMode"];
  /** Mutations with the same scope id run one after another. */
  readonly scope?: string | ((input: I) => string) | undefined;
  /** How long a settled, unobserved execution stays in the mutation cache. Default 5 minutes. */
  readonly gcTime?: MutationOptions<I, A, E, R, C>["gcTime"];
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
  /**
   * Persist executions paused while offline (`QueryPersister`), to resume
   * them after a reload. Needs a `key`; register the same definition with
   * `client.setMutationDefaults(key, ...)` so the restored execution has a `run`.
   */
  readonly persist?: MutationOptions<I, A, E, R, C>["persist"];
}

/**
 * A mutation: a writable atom holding the latest execution started through it
 * (in this registry). Write an input to run it, `Atom.Reset` to clear it.
 *
 * @since 0.1.0
 * @category models
 */
export interface MutationAtom<I, A, E = never, R = never, C = unknown> extends Atom.Writable<
  MutationResult.MutationResult<A, E, I, C>,
  I | Atom.Reset
> {
  readonly [TypeId]: TypeId;
  readonly key: MutationKey | undefined;
  /**
   * The definition. Typed loosely so `E` / `C` stay covariant and any
   * mutation atom fits `MutationAtom<I, any, any, any, any>`.
   */
  readonly options: MutationOptions<any, any, any, any, any>;
  /** The definition's `run`. */
  readonly run: (input: I) => Effect.Effect<A, E, R>;
}

/**
 * @since 0.1.0
 * @category guards
 */
export const isMutationAtom = (
  u: unknown,
): u is MutationAtom<unknown, unknown, unknown, unknown, unknown> => Atom.isAtom(u) && TypeId in u;

/**
 * Defines a mutation.
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = <I = void, A = void, E = never, R = never, C = never>(
  definition: Definition<I, A, E, R, C>,
): MutationAtom<I, A, E, R, C> => {
  const options = definition as MutationOptions<I, A, E, R, C>;
  const latest = Atom.make(Option.none<MutationEntry<I, A, E, C>>()).pipe(
    Atom.withLabel(`Mutation.latest(${QueryKey.toJsonKey(definition.key ?? [])})`),
  );
  const self: MutationAtom<I, A, E, R, C> = Object.assign(
    Atom.writable<MutationResult.MutationResult<A, E, I, C>, I | Atom.Reset>(
      (get) => {
        const entry = get(latest);
        if (Option.isNone(entry)) return MutationResult.idle<A, E, I, C>();
        const execution = entry.value;
        const release = execution.addObserver();
        const unsubscribe = execution.subscribe(() =>
          get.setSelf(MutationResult.project(execution.state)),
        );
        get.addFinalizer(() => {
          unsubscribe();
          release();
        });
        return MutationResult.project(execution.state);
      },
      (ctx, value) => {
        if (value === Atom.Reset) {
          ctx.set(latest, Option.none());
          return;
        }
        const client = QueryClient.fromAtomContext(ctx);
        const execution = client.mutationCache.build<I, A, E, C>(options, self);
        ctx.set(latest, Option.some(execution));
        execution.execute(value as I);
      },
    ),
    { [TypeId]: TypeId, key: definition.key, options, run: definition.run } as const,
  );
  return self;
};

/**
 * Optimistic updates "via the UI": an atom showing `query` with every pending
 * execution of `mutation` applied on top, in submission order. Nothing is
 * written to the cache, so there is nothing to roll back: when a mutation
 * settles its overlay disappears. An execution whose `run` succeeded stops
 * being applied as soon as the query holds data *requested* after that (its
 * `invalidates` refetch), so the change is never shown twice, and a fetch that
 * started before the server write cannot hide it.
 *
 * ```ts
 * const optimisticTodos = Mutation.optimistic(todosQuery, addTodo, (todos, title) =>
 *   [...todos, { id: "pending", title }])
 * ```
 *
 * @since 0.1.0
 * @category combinators
 */
export const optimistic = <A, E, I>(
  query: Query.QueryAtom<A, E, any>,
  mutation: MutationAtom<I, any, any, any, any>,
  apply: (data: A, input: I) => A,
): Atom.Atom<QueryResult.QueryResult<A, E>> =>
  Atom.readable((get) => {
    const client = QueryClient.fromAtomContext(get);
    const base = get(query);
    const unsubscribe = client.mutationCache.subscribe(() => get.refreshSelf());
    get.addFinalizer(unsubscribe);
    const dataRequestedAt = Option.match(client.cache.get(query.key), {
      onNone: () => 0,
      onSome: (entry) => entry.state.dataRequestedAt,
    });
    const pending = client.mutationCache
      .findAll({ mutation, status: "pending" })
      // Already reflected in data requested after `run` succeeded. (A fetch
      // that started earlier but landed later may not contain the change.)
      .filter((execution) => execution.state.ranAt === 0 || execution.state.ranAt > dataRequestedAt)
      .sort((a, b) => a.state.submittedAt - b.state.submittedAt || a.id - b.id);
    if (pending.length === 0 || Option.isNone(base.data)) return base;
    return QueryResult.map(base, (data) =>
      pending.reduce(
        (acc, execution) =>
          Option.isSome(execution.state.variables)
            ? apply(acc, execution.state.variables.value)
            : acc,
        data,
      ),
    );
  });
