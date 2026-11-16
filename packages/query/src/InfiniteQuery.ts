/**
 * Infinite (paginated) queries.
 *
 * ```ts
 * const feed = InfiniteQuery.make({
 *   key: (filter: string) => ["feed", filter],
 *   run: (filter, cursor: number) => Api.feed(filter, cursor),
 *   initialPageParam: 0,
 *   getNextPageParam: (lastPage) => lastPage.nextCursor, // Option<number>
 * })
 *
 * registry.set(feed("all"), "next")     // load the next page
 * useInfiniteQuery(feed("all"))        // hasNextPage, fetchNextPage, ...
 * ```
 *
 * The cached data is `{ pages, pageParams }`. A refetch (stale on mount,
 * focus, invalidation…) refetches every loaded page in order, starting from
 * the first page param and following `getNextPageParam` of the fresh pages,
 * so the list stays consistent.
 *
 * @since 0.1.0
 */
import { Effect, Option } from "effect";
import { Atom } from "effect/reactivity";
import type { BehaviorContext, PersistCodec, QueryEntry } from "./internal/queryEntry.ts";
import { infiniteCodec, persistCodec, type PersistSchema } from "./internal/persistCodec.ts";
import * as Query from "./Query.ts";
import type * as QueryKey from "./QueryKey.ts";
import type * as QueryResult from "./QueryResult.ts";

/**
 * @since 0.1.0
 * @category models
 */
export interface InfiniteData<Page, Param> {
  readonly pages: ReadonlyArray<Page>;
  readonly pageParams: ReadonlyArray<Param>;
}

/**
 * Computes the param of the page after `lastPage` (or before `firstPage`).
 * `None` means there is no such page.
 *
 * @since 0.1.0
 * @category models
 */
export type GetPageParam<Page, Param> = (
  page: Page,
  allPages: ReadonlyArray<Page>,
  pageParam: Param,
  allPageParams: ReadonlyArray<Param>,
) => Option.Option<Param>;

/**
 * @since 0.1.0
 * @category models
 */
export interface Config<Page, Param> {
  readonly initialPageParam: Param;
  readonly getNextPageParam: GetPageParam<Page, Param>;
  readonly getPreviousPageParam?: GetPageParam<Page, Param> | undefined;
  /** Keep at most this many pages (dropping from the other end). */
  readonly maxPages?: number | undefined;
}

/**
 * Write `"next"` / `"previous"` to an infinite query atom to load a page.
 *
 * @since 0.1.0
 * @category models
 */
export type PageDirection = "next" | "previous";

/**
 * @since 0.1.0
 * @category models
 */
export interface InfiniteQueryAtom<Page, Param, E = never, R = never>
  extends
    Query.QueryAtom<InfiniteData<Page, Param>, E, R>,
    Atom.Writable<QueryResult.QueryResult<InfiniteData<Page, Param>, E>, PageDirection> {
  readonly infinite: Config<Page, Param>;
}

/**
 * @since 0.1.0
 * @category models
 */
export interface Definition<Arg, Page, Param, E, R>
  extends Omit<Query.QueryOptions<E>, "enabled">, Omit<Config<Page, Param>, "initialPageParam"> {
  readonly key: (arg: Arg) => QueryKey.QueryKey;
  readonly run: (arg: Arg, pageParam: Param) => Effect.Effect<Page, E, R>;
  readonly initialPageParam: Param | ((arg: Arg) => Param);
  readonly enabled?: boolean | ((arg: Arg) => boolean) | undefined;
  /**
   * Opt into persistence with schemas for pages and page params: Effect
   * Schemas or Standard Schema validators (see `Query.PersistSchema`).
   */
  readonly persist?:
    | { readonly page: PersistSchema<Page>; readonly pageParam: PersistSchema<Param> }
    | undefined;
}

/**
 * @since 0.1.0
 * @category models
 */
export interface InfiniteQueryFamily<Arg, Page, Param, E = never, R = never> {
  (arg: Arg): InfiniteQueryAtom<Page, Param, E, R>;
  (
    arg: Arg | Query.SkipToken,
  ): InfiniteQueryAtom<Page, Param, E, R> | Query.SkippedQueryAtom<InfiniteData<Page, Param>, E>;
  readonly key: (arg: Arg) => QueryKey.Tagged<InfiniteData<Page, Param>, E>;
}

/**
 * @since 0.1.0
 * @category guards
 */
export const isInfiniteQueryAtom = (
  u: unknown,
): u is InfiniteQueryAtom<unknown, unknown, unknown, unknown> =>
  Query.isQueryAtom(u) && "infinite" in u;

/**
 * Defines a parameterised infinite query.
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = <Arg, Page, Param, E = never, R = never>(
  definition: Definition<Arg, Page, Param, E, R>,
): InfiniteQueryFamily<Arg, Page, Param, E, R> => {
  const {
    key,
    run,
    enabled,
    initialPageParam,
    getNextPageParam,
    getPreviousPageParam,
    maxPages,
    persist,
    ...options
  } = definition;
  const codec =
    persist === undefined
      ? undefined
      : (infiniteCodec(persistCodec(persist.page), persistCodec(persist.pageParam)) as PersistCodec<
          InfiniteData<Page, Param>
        >);
  const instance = Atom.family((arg: Arg) =>
    makeAtom<Page, Param, E, R>({
      key: key(arg) as QueryKey.Tagged<InfiniteData<Page, Param>, E>,
      fetchPage: (param) => run(arg, param),
      options: { ...options, enabled: typeof enabled === "function" ? enabled(arg) : enabled },
      persist: codec,
      config: {
        initialPageParam:
          typeof initialPageParam === "function"
            ? (initialPageParam as (arg: Arg) => Param)(arg)
            : initialPageParam,
        getNextPageParam,
        getPreviousPageParam,
        maxPages,
      },
    }),
  );
  const skipped = Query.makeSkipped<InfiniteData<Page, Param>, E>();
  const family = (arg: Arg | Query.SkipToken) =>
    arg === Query.skipToken ? skipped : instance(arg);
  return Object.assign(family, {
    key: (arg: Arg) => key(arg) as QueryKey.Tagged<InfiniteData<Page, Param>, E>,
  }) as unknown as InfiniteQueryFamily<Arg, Page, Param, E, R>;
};

/**
 * TanStack-style alias: an infinite query without arguments.
 *
 * @since 0.1.0
 * @category constructors
 */
export const infiniteQueryOptions = <Page, Param, E = never, R = never>(
  definition: Omit<
    Definition<void, Page, Param, E, R>,
    "key" | "run" | "initialPageParam" | "enabled"
  > & {
    readonly key: QueryKey.QueryKey;
    readonly run: (pageParam: Param) => Effect.Effect<Page, E, R>;
    readonly initialPageParam: Param;
    readonly enabled?: boolean | undefined;
  },
): InfiniteQueryAtom<Page, Param, E, R> =>
  make<void, Page, Param, E, R>({
    ...definition,
    key: () => definition.key,
    run: (_, param) => definition.run(param),
  })();

// ---------------------------------------------------------------------------
// paging
// ---------------------------------------------------------------------------

/**
 * The param of the next page, if any.
 *
 * @since 0.1.0
 * @category paging
 */
export const nextPageParam = <Page, Param>(
  config: Config<Page, Param>,
  data: InfiniteData<Page, Param>,
): Option.Option<Param> => {
  const last = data.pages.length - 1;
  if (last < 0) {
    return Option.none();
  }
  return config.getNextPageParam(
    data.pages[last]!,
    data.pages,
    data.pageParams[last]!,
    data.pageParams,
  );
};

/**
 * The param of the previous page, if any.
 *
 * @since 0.1.0
 * @category paging
 */
export const previousPageParam = <Page, Param>(
  config: Config<Page, Param>,
  data: InfiniteData<Page, Param>,
): Option.Option<Param> => {
  if (config.getPreviousPageParam === undefined || data.pages.length === 0) {
    return Option.none();
  }
  return config.getPreviousPageParam(
    data.pages[0]!,
    data.pages,
    data.pageParams[0]!,
    data.pageParams,
  );
};

const append = <Page, Param>(
  data: InfiniteData<Page, Param>,
  page: Page,
  param: Param,
  maxPages: number | undefined,
): InfiniteData<Page, Param> => {
  const pages = [...data.pages, page];
  const pageParams = [...data.pageParams, param];
  const drop = maxPages !== undefined && pages.length > maxPages ? pages.length - maxPages : 0;
  return { pages: pages.slice(drop), pageParams: pageParams.slice(drop) };
};

const prepend = <Page, Param>(
  data: InfiniteData<Page, Param>,
  page: Page,
  param: Param,
  maxPages: number | undefined,
): InfiniteData<Page, Param> => {
  const pages = [page, ...data.pages];
  const pageParams = [param, ...data.pageParams];
  const keep = maxPages !== undefined ? maxPages : pages.length;
  return { pages: pages.slice(0, keep), pageParams: pageParams.slice(0, keep) };
};

/** @internal The fetch behavior: one page in a direction, or every loaded page in order. */
export const behavior =
  <Page, Param, E, R>(
    config: Config<Page, Param>,
    fetchPage: (param: Param) => Effect.Effect<Page, E, R>,
  ) =>
  ({
    data,
    direction,
  }: BehaviorContext<InfiniteData<Page, Param>>): Effect.Effect<InfiniteData<Page, Param>, E, R> =>
    Effect.gen(function* () {
      const empty: InfiniteData<Page, Param> = { pages: [], pageParams: [] };
      if (Option.isSome(data) && data.value.pages.length > 0 && direction !== undefined) {
        const current = data.value;
        const param =
          direction === "forward"
            ? nextPageParam(config, current)
            : previousPageParam(config, current);
        if (Option.isNone(param)) {
          return current;
        }
        const page = yield* fetchPage(param.value);
        return direction === "forward"
          ? append(current, page, param.value, config.maxPages)
          : prepend(current, page, param.value, config.maxPages);
      }
      // Initial load, or refetch of every loaded page in order.
      const previous = Option.getOrElse(data, () => empty);
      const count = Math.max(previous.pages.length, 1);
      let result = empty;
      let param: Option.Option<Param> = Option.some(
        previous.pageParams[0] ?? config.initialPageParam,
      );
      for (let i = 0; i < count && Option.isSome(param); i++) {
        const page = yield* fetchPage(param.value);
        result = append(result, page, param.value, undefined);
        param = nextPageParam(config, result);
      }
      return result;
    });

const makeAtom = <Page, Param, E, R>(descriptor: {
  readonly key: QueryKey.Tagged<InfiniteData<Page, Param>, E>;
  readonly fetchPage: (param: Param) => Effect.Effect<Page, E, R>;
  readonly options: Query.QueryOptions<E>;
  readonly config: Config<Page, Param>;
  readonly persist: PersistCodec<InfiniteData<Page, Param>> | undefined;
}): InfiniteQueryAtom<Page, Param, E, R> => {
  const fetchBehavior = behavior(descriptor.config, descriptor.fetchPage);
  return Query.makeAtom<
    InfiniteData<Page, Param>,
    E,
    R,
    PageDirection,
    { readonly infinite: Config<Page, Param> }
  >(
    {
      key: descriptor.key,
      run: fetchBehavior({ data: Option.none(), direction: undefined }),
      options: descriptor.options,
      initialData: undefined,
      behavior: fetchBehavior,
      persist: descriptor.persist,
    },
    {
      fields: { infinite: descriptor.config },
      write: (entry, direction) => {
        entry.fetch({
          direction: direction === "next" ? "forward" : "backward",
          cancelRefetch: true,
        });
      },
    },
  ) as InfiniteQueryAtom<Page, Param, E, R>;
};

/**
 * Paging state derived from a cache entry's data and its running fetch.
 *
 * @since 0.1.0
 * @category models
 */
export interface PagingState {
  readonly hasNextPage: boolean;
  readonly hasPreviousPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly isFetchingPreviousPage: boolean;
  readonly isFetchNextPageError: boolean;
  readonly isFetchPreviousPageError: boolean;
}

/** @internal */
export const pagingState = <Page, Param>(
  config: Config<Page, Param>,
  entry: QueryEntry<any, any> | undefined,
): PagingState => {
  const state = entry?.state;
  const data = state?.data ?? Option.none();
  const fetching = state?.fetchStatus === "fetching";
  const direction = state?.fetchDirection;
  const errored = state?.status === "error";
  return {
    hasNextPage: Option.isSome(data) && Option.isSome(nextPageParam(config, data.value)),
    hasPreviousPage: Option.isSome(data) && Option.isSome(previousPageParam(config, data.value)),
    isFetchingNextPage: fetching && direction === "forward",
    isFetchingPreviousPage: fetching && direction === "backward",
    isFetchNextPageError: errored && direction === "forward",
    isFetchPreviousPageError: errored && direction === "backward",
  };
};
