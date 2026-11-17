/**
 * Test utilities for apps that use @effect-atom-query/react:
 *
 * ```ts
 * import { makeTestHarness, queryHookResult } from "@effect-atom-query/react/testing"
 * ```
 *
 * Nothing here depends on a test runner.
 *
 * @since 1.3.0
 */
import { type MutationResult, QueryClient, type QueryResult } from "@effect-atom-query/query";
import { scheduleTask } from "@effect/atom-react";
import { Deferred, Effect, Exit, Layer, ManagedRuntime } from "effect";
import { AtomRegistry } from "effect/reactivity";
import * as React from "react";
import { QueryClientProvider } from "./QueryClientProvider.tsx";
import type { UseMutationResult } from "./useMutation.ts";

// ---------------------------------------------------------------------------
// hook results
// ---------------------------------------------------------------------------

/**
 * A `useQuery` result for mocking a hook: the given `QueryResult` plus a
 * no-op `refetch`, and any overrides. Keeps the narrow type of the result, so
 * a success fits a hook that returns a defined result.
 *
 * ```ts
 * vi.mocked(useTodosQuery).mockReturnValue(queryHookResult(QueryResult.success(todos)))
 * ```
 *
 * @since 1.3.0
 * @category hook results
 */
export const queryHookResult = <Q extends QueryResult.QueryResult<any, any>>(
  result: Q,
  overrides?: { readonly refetch?: (() => void) | undefined },
): Q & { readonly refetch: () => void } => ({
  ...result,
  // `undefined` keeps the default, so an override cannot remove the function.
  refetch: overrides?.refetch ?? (() => {}),
});

/**
 * A `useMutation` result for mocking a hook: the given `MutationResult` plus
 * `mutate` and `reset` no-ops, and any overrides. `mutateEffect` fails with a
 * defect unless overridden, so a test that awaits it notices.
 *
 * ```ts
 * const mutate = vi.fn()
 * vi.mocked(useSaveTodo).mockReturnValue(mutationHookResult(MutationResult.idle(), { mutate }))
 * ```
 *
 * @since 1.3.0
 * @category hook results
 */
export const mutationHookResult = <A, E = never, I = void, C = unknown, R = never>(
  result: MutationResult.MutationResult<A, E, I, C>,
  overrides?: {
    readonly mutate?: UseMutationResult<A, E, I, C, R>["mutate"] | undefined;
    readonly mutateEffect?: UseMutationResult<A, E, I, C, R>["mutateEffect"] | undefined;
    readonly reset?: UseMutationResult<A, E, I, C, R>["reset"] | undefined;
  },
): UseMutationResult<A, E, I, C, R> =>
  // `undefined` keeps the default, so an override cannot remove a function.
  ({
    ...result,
    mutate: overrides?.mutate ?? (() => {}),
    mutateEffect:
      overrides?.mutateEffect ??
      (() =>
        Effect.die(
          new Error("mutationHookResult: mutateEffect is not mocked; pass it in the overrides"),
        )),
    reset: overrides?.reset ?? (() => {}),
  }) as UseMutationResult<A, E, I, C, R>;

// ---------------------------------------------------------------------------
// fake responses
// ---------------------------------------------------------------------------

/**
 * @since 1.3.0
 * @category fake responses
 */
export interface Controlled<A, E> {
  /** Waits until the test completes it. Every run waits for the same outcome. */
  readonly effect: Effect.Effect<A, E>;
  readonly succeed: (value: A) => void;
  readonly fail: (error: E) => void;
  /** Fail with a defect. */
  readonly die: (defect: unknown) => void;
  readonly isDone: () => boolean;
}

/**
 * A response that stays pending until the test completes it, for testing
 * loading states through real hooks:
 *
 * ```ts
 * const todos = controlled<ReadonlyArray<Todo>>()
 * const harness = makeTestHarness({ layer: fakeRepo({ list: todos.effect }) })
 * render(<Todos />, { wrapper: harness.Wrapper })
 * expect(screen.getByText("Loading…")).toBeTruthy()
 * act(() => todos.succeed([todo]))
 * ```
 *
 * The first completion wins; later calls are ignored.
 *
 * @since 1.3.0
 * @category fake responses
 */
export const controlled = <A, E = never>(): Controlled<A, E> => {
  const deferred = Deferred.makeUnsafe<A, E>();
  const done = (exit: Exit.Exit<A, E>) => {
    Deferred.doneUnsafe(deferred, exit);
  };
  return {
    effect: Deferred.await(deferred),
    succeed: (value) => done(Exit.succeed(value)),
    fail: (error) => done(Exit.fail(error)),
    die: (defect) => done(Exit.die(defect)),
    isDone: () => Deferred.isDoneUnsafe(deferred),
  };
};

// ---------------------------------------------------------------------------
// client and harness
// ---------------------------------------------------------------------------

/**
 * Client defaults for tests: no retries, no refetch on window focus or
 * reconnect, and no garbage collection timers. Failures show at once and
 * nothing refetches unexpectedly.
 *
 * @since 1.3.0
 * @category client
 */
export const testDefaultOptions: QueryClient.DefaultOptions = {
  queries: {
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: "Infinity",
  },
  mutations: { retry: false },
};

/**
 * `QueryClient.layer` with {@link testDefaultOptions}. Options you pass are
 * merged over them.
 *
 * @since 1.3.0
 * @category client
 */
export const testQueryClientLayer = (
  options?: QueryClient.Options,
): Layer.Layer<QueryClient.QueryClient> =>
  QueryClient.layer({
    ...options,
    defaultOptions: {
      queries: { ...testDefaultOptions.queries, ...options?.defaultOptions?.queries },
      mutations: { ...testDefaultOptions.mutations, ...options?.defaultOptions?.mutations },
    },
  });

/**
 * @since 1.3.0
 * @category harness
 */
export interface TestHarness<R, E> {
  /** A runtime with the test client and your layer. */
  readonly runtime: ManagedRuntime.ManagedRuntime<QueryClient.QueryClient | R, E>;
  /** The registry the provider binds the client into. Read and set atoms with it. */
  readonly registry: AtomRegistry.AtomRegistry;
  readonly client: QueryClient.Service;
  /** The provider, for `render(ui, { wrapper })` and `renderHook`. */
  readonly Wrapper: (props: { readonly children?: React.ReactNode }) => React.ReactElement;
  /** Run an Effect with the client and your services. */
  readonly run: <A, X>(effect: Effect.Effect<A, X, QueryClient.QueryClient | R>) => Promise<A>;
  /** Dispose the runtime (stopping every fiber) and the registry. Safe to call before unmounting. */
  readonly dispose: () => Promise<void>;
}

/**
 * Everything a component or hook test needs: a client with
 * {@link testDefaultOptions}, your fake services, a registry, and a provider.
 *
 * ```tsx
 * let harness: TestHarness<TodoRepo, never>
 * beforeEach(() => { harness = makeTestHarness({ layer: FakeTodoRepo }) })
 * afterEach(() => harness.dispose())
 *
 * it("lists todos", async () => {
 *   harness.registry.set(filterAtom, "open") // instead of Redux's preloadedState
 *   render(<Todos />, { wrapper: harness.Wrapper })
 *   expect(await screen.findByText("learn Effect")).toBeTruthy()
 * })
 * ```
 *
 * @since 1.3.0
 * @category harness
 */
export const makeTestHarness = <R = never, E = never>(options?: {
  /** Your (fake) services. */
  readonly layer?: Layer.Layer<R, E> | undefined;
  /** Merged over {@link testDefaultOptions}. */
  readonly client?: QueryClient.Options | undefined;
}): TestHarness<R, E> => {
  const clientLayer = testQueryClientLayer(options?.client);
  const layer = (
    options?.layer === undefined ? clientLayer : clientLayer.pipe(Layer.provideMerge(options.layer))
  ) as Layer.Layer<QueryClient.QueryClient | R, E>;
  const runtime = ManagedRuntime.make(layer);
  const client = runtime.runSync(QueryClient.QueryClient);
  const registry = AtomRegistry.make({ scheduleTask });
  const Wrapper = ({ children }: { readonly children?: React.ReactNode }) => (
    <QueryClientProvider client={client} registry={registry}>
      {children}
    </QueryClientProvider>
  );
  return {
    runtime,
    registry,
    client,
    Wrapper,
    run: (effect) => runtime.runPromise(effect),
    dispose: async () => {
      await runtime.dispose();
      registry.dispose();
    },
  };
};
