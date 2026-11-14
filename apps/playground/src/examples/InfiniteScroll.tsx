import { InfiniteQuery, useInfiniteQuery } from "@effect-atom-query/react";
import { Fragment, useEffect, useRef } from "react";
import { Api } from "../api.ts";
import { errorMessage, type Example } from "../ui.tsx";

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
    if (el === null) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) callback.current();
    });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
};

function InfiniteScroll() {
  const feed = useInfiniteQuery(feedQuery());
  const pages = feed.isSuccess ? feed.data.value.pages.length : 0;
  const sentinel = useInView(() => {
    if (feed.hasNextPage && !feed.isFetching) feed.fetchNextPage();
  }, [pages, feed.isFetching]);

  if (feed.isPending) return <p>Loading...</p>;
  if (feed.isError) return <p>Error: {errorMessage(feed)}</p>;
  return (
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
      <div
        style={{ maxHeight: 260, overflow: "auto", border: "1px solid #e2e8f0", margin: "8px 0" }}
      >
        {feed.data.value.pages.map((page, i) => (
          <Fragment key={feed.data.value.pageParams[i]}>
            {page.items.map((item) => (
              <p
                key={item.id}
                style={{ margin: 0, padding: "10px 8px", borderBottom: "1px solid #f1f5f9" }}
              >
                {item.text}
              </p>
            ))}
          </Fragment>
        ))}
        <div ref={sentinel} style={{ padding: 8, color: "#64748b" }}>
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
}

export const example: Example = {
  id: "infinite-scroll",
  title: "Load more & infinite scroll",
  tanstack: "load-more-infinite-scroll",
  description:
    "A bidirectional infinite query: an IntersectionObserver loads newer pages, a button loads older ones. A refetch reloads every page in order.",
  Component: InfiniteScroll,
};
