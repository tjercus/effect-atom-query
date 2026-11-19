import { InfiniteQuery, QueryResult, useInfiniteQuery } from "@effect-atom-query/react";
import { Option } from "effect";
import { Api, type FeedPage } from "../api.ts";
import { errorMessage, type Example, StaleDataError } from "../ui.tsx";

const feedQuery = InfiniteQuery.make({
  key: () => ["feed", "max-pages"],
  run: (_: void, cursor: number) => Api.use((api) => api.feed(cursor)),
  initialPageParam: 0,
  getNextPageParam: (page) => page.next,
  getPreviousPageParam: (page) => page.previous,
  maxPages: 3,
});

function MaxPages() {
  const feed = useInfiniteQuery(feedQuery());
  const view = ({ pages, pageParams }: InfiniteQuery.InfiniteData<FeedPage, number>) => (
    <div>
      <p>
        At most 3 pages are kept: loading a page at one end drops one at the other. Cached pages:{" "}
        <code data-testid="page-params">[{pageParams.join(", ")}]</code>
      </p>
      <button onClick={feed.fetchPreviousPage} disabled={!feed.hasPreviousPage || feed.isFetching}>
        {feed.isFetchingPreviousPage ? "Loading..." : "Previous page"}
      </button>
      {pages.map((page, i) => (
        <fieldset key={pageParams[i]} style={{ margin: "8px 0" }}>
          <legend>page {pageParams[i]}</legend>
          {page.items.map((item) => item.text).join(" · ")}
        </fieldset>
      ))}
      <button onClick={feed.fetchNextPage} disabled={!feed.hasNextPage || feed.isFetching}>
        {feed.isFetchingNextPage ? "Loading..." : "Next page"}
      </button>
    </div>
  );
  return QueryResult.match(feed, {
    onPending: () => <p>Loading...</p>,
    // A failed page (or refetch) keeps the pages already loaded; the
    // buttons stay, so loading the page again is a retry.
    onFailure: (failure) =>
      Option.match(failure.data, {
        onNone: () => <p>Error: {errorMessage(failure)}</p>,
        onSome: (data) => (
          <>
            {view(data)}
            <StaleDataError failure={failure} />
          </>
        ),
      }),
    onSuccess: (success) => view(success.data.value),
  });
}

export const example: Example = {
  id: "max-pages",
  title: "Infinite query with max pages",
  tanstack: "infinite-query-with-max-pages",
  description: "maxPages bounds the memory an infinite list uses.",
  Component: MaxPages,
};
