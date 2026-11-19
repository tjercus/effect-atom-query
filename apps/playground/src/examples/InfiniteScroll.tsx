import { InfiniteQuery, QueryResult, useInfiniteQuery } from "@effect-atom-query/react";
import { Option } from "effect";
import { Fragment, useEffect, useRef } from "react";
import { Api, type FeedPage } from "../api.ts";
import { errorMessage, type Example, StaleDataError } from "../ui.tsx";

const feedQuery = InfiniteQuery.make({
  key: () => ["feed", "scroll"],
  run: (_: void, cursor: number) => Api.use((api) => api.feed(cursor)),
  initialPageParam: 0,
  getNextPageParam: (page) => page.next,
  getPreviousPageParam: (page) => page.previous,
});

/**
 * Calls `onVisible` whenever the element is in view, and again whenever
 * `deps` change while it still is (a short page may not push it out).
 */
const useInView = (onVisible: () => void, deps: ReadonlyArray<unknown>) => {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onVisible);
  callback.current = onVisible;
  useEffect(() => {
    const el = ref.current;
    if (el === null) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        callback.current();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
};

function InfiniteScroll() {
  const feed = useInfiniteQuery(feedQuery());
  // Pages still on screen, also after a failed fetch.
  const pages = Option.match(feed.data, {
    onNone: () => 0,
    onSome: (data) => data.pages.length,
  });
  const sentinel = useInView(() => {
    // After a failed next page, wait for "Retry" instead of looping.
    if (feed.hasNextPage && !feed.isFetching && !feed.isFetchNextPageError) {
      feed.fetchNextPage();
    }
  }, [pages, feed.isFetching]);

  const view = (data: InfiniteQuery.InfiniteData<FeedPage, number>) => (
    <div>
      <button
        onClick={feed.fetchPreviousPage}
        disabled={!feed.hasPreviousPage || feed.isFetchingPreviousPage}
      >
        {feed.isFetchingPreviousPage
          ? "Loading more..."
          : feed.hasPreviousPage
            ? "Load Older"
            : "Nothing more to load"}
      </button>
      <div className="scroll-box">
        {data.pages.map((page, i) => (
          <Fragment key={data.pageParams[i]}>
            {page.items.map((item) => (
              <p key={item.id}>{item.text}</p>
            ))}
          </Fragment>
        ))}
        <div ref={sentinel} className="sentinel">
          {feed.isFetchingNextPage
            ? "Loading more..."
            : feed.hasNextPage
              ? "Scroll for more"
              : "Nothing more to load"}
        </div>
      </div>
      <div>{feed.isFetching && !feed.isFetchingNextPage ? "Background Updating..." : null}</div>
    </div>
  );

  return QueryResult.match(feed, {
    onPending: () => <p>Loading...</p>,
    // A failed page (or refetch) keeps the pages already loaded.
    onFailure: (failure) =>
      Option.match(failure.data, {
        onNone: () => <p>Error: {errorMessage(failure)}</p>,
        onSome: (data) => (
          <>
            {view(data)}
            <StaleDataError failure={failure} />
            <button
              onClick={
                // Retry what failed: a page in either direction, or the refetch.
                feed.isFetchPreviousPageError
                  ? feed.fetchPreviousPage
                  : feed.isFetchNextPageError
                    ? feed.fetchNextPage
                    : feed.refetch
              }
            >
              Retry
            </button>
          </>
        ),
      }),
    onSuccess: (success) => view(success.data.value),
  });
}

export const example: Example = {
  id: "infinite-scroll",
  title: "Load more & infinite scroll",
  tanstack: "load-more-infinite-scroll",
  description:
    "A bidirectional infinite query: an IntersectionObserver loads newer pages, a button loads older ones. A refetch reloads every page in order.",
  Component: InfiniteScroll,
};
