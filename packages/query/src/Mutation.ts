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
import { type Cause, Effect, type Exit, Option } from "effect";
import { Atom } from "effect/reactivity";
import type { MutationEntry, MutationKey, MutationOptions } from "./internal/mutationEntry.ts";
import type { ReactivityKeys } from "./internal/queryEntry.ts";
import * as Query from "./Query.ts";
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
        if (Option.isNone(entry)) {
          return MutationResult.idle<A, E, I, C>();
        }
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
    // Reading `query` above built its entry, so this returns that same entry.
    const dataRequestedAt = client.cache.build<A, E>(query).state.dataRequestedAt;
    const pending = client.mutationCache
      .findAll({ mutation, status: "pending" })
      // Already reflected in data requested after `run` succeeded. (A fetch
      // that started earlier but landed later may not contain the change.)
      .filter((execution) => execution.state.ranAt === 0 || execution.state.ranAt > dataRequestedAt)
      .sort((a, b) => a.state.submittedAt - b.state.submittedAt || a.id - b.id);
    if (pending.length === 0 || Option.isNone(base.data)) {
      return base;
    }
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

/**
 * Optimistic updates "via the cache": the `onMutate` / `onError` / `onSettled`
 * callbacks that write `update` into `query`'s cached data before `run`, roll
 * it back if the mutation fails, and refetch the query once it settles. Spread
 * them into a definition:
 *
 * ```ts
 * const deleteTodo = Mutation.make({
 *   run: (id: string) => TodoRepo.use((repo) => repo.delete(id)),
 *   ...Mutation.optimisticUpdate(todosQuery, (todos, id) => todos.filter((t) => t.id !== id)),
 * })
 * ```
 *
 * `onMutate` does nothing while the query has no data, so a first load keeps
 * running. Otherwise it cancels the query's running fetches (so they cannot
 * overwrite the update), snapshots the data and applies `update`. `query` can
 * also be a function of the input, to target one member of a family:
 * `(todo) => todoQuery(todo.id)`.
 *
 * `onError` restores the snapshot. `onSettled` then invalidates the query,
 * after success and failure alike, and waits for an active query to refetch,
 * so the cache ends up matching the server. That also corrects the cache when
 * executions overlap: a rollback restores a snapshot taken before another
 * execution's update, and the refetch after that other execution settles
 * brings its change back. It also covers a snapshot older than the fetch that
 * was cancelled, and a resumed persisted execution, which has no snapshot.
 * An inactive query is only marked stale, and refetches when it is next used.
 * An interrupted execution runs no callbacks, so its update stays until the
 * query refetches.
 *
 * The query is refetched already: list it in `invalidates` only if you want a
 * second refetch. Unlike {@link optimistic}, this changes the cache, so every
 * reader sees the update, also outside React. To add your own callbacks, call
 * these from yours:
 *
 * ```ts
 * const cache = Mutation.optimisticUpdate(todosQuery, removeTodo)
 * Mutation.make({
 *   run,
 *   ...cache,
 *   onError: (cause, id, context) => Effect.andThen(cache.onError(cause, id, context), showError),
 * })
 * ```
 *
 * @since 1.1.0
 * @category combinators
 */
export const optimisticUpdate = <A, I>(
  query: Query.QueryAtom<A, any, any> | ((input: I) => Query.QueryAtom<A, any, any>),
  update: (data: A, input: I) => A,
): {
  readonly onMutate: (input: I) => Effect.Effect<Option.Option<A>, never, QueryClient.QueryClient>;
  readonly onError: (
    cause: Cause.Cause<unknown>,
    input: I,
    context: Option.Option<Option.Option<A>>,
  ) => Effect.Effect<void, never, QueryClient.QueryClient>;
  readonly onSettled: (
    exit: Exit.Exit<unknown, unknown>,
    input: I,
    context: Option.Option<Option.Option<A>>,
  ) => Effect.Effect<void, never, QueryClient.QueryClient>;
} => {
  const target = (input: I): Query.QueryAtom<A, any, any> =>
    Query.isQueryAtom(query) ? query : query(input);
  return {
    onMutate: (input) =>
      Effect.gen(function* () {
        const client = yield* QueryClient.QueryClient;
        const atom = target(input);
        if (Option.isNone(yield* client.getQueryData(atom))) {
          return Option.none();
        }
        yield* client.cancelQueries({ queryKey: atom.key, exact: true });
        // Read again: cancelling restores the state from before the fetch.
        const previous = yield* client.getQueryData(atom);
        if (Option.isSome(previous)) {
          yield* client.setQueryData(atom, () => Option.some(update(previous.value, input)));
        }
        return previous;
      }),
    onError: (_cause, input, context) =>
      Effect.gen(function* () {
        const previous = Option.flatten(context);
        if (Option.isNone(previous)) {
          return;
        }
        const client = yield* QueryClient.QueryClient;
        yield* client.setQueryData(target(input), () => previous);
      }),
    onSettled: (_exit, input, context) =>
      Effect.gen(function* () {
        // `onMutate` found no data, so it wrote nothing (a resumed execution,
        // with no context at all, may have written before the reload).
        if (Option.isSome(context) && Option.isNone(context.value)) {
          return;
        }
        const client = yield* QueryClient.QueryClient;
        yield* client.invalidateQueries({ queryKey: target(input).key, exact: true });
      }),
  };
};
