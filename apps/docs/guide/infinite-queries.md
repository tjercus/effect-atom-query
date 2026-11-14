# Infinite queries

```ts
const feedQuery = InfiniteQuery.make({
  key: (topic: string) => ["feed", topic],
  run: (topic, cursor: number) => Feed.use((feed) => feed.page(topic, cursor)),
  initialPageParam: 0,
  getNextPageParam: (lastPage) => lastPage.nextCursor, // Option<number>
  getPreviousPageParam: (firstPage) => firstPage.previousCursor, // optional
  maxPages: 5, // optional
});
```

Page param functions return an `Option`: `None` means there are no more pages.
The cached data is `InfiniteData<Page, Param>`, that is `{ pages, pageParams }`.

```tsx
const feed = useInfiniteQuery(feedQuery("effect"));

feed.data; // Option<InfiniteData<Page, number>>
(feed.hasNextPage, feed.hasPreviousPage);
(feed.isFetchingNextPage, feed.isFetchingPreviousPage);
(feed.isFetchNextPageError, feed.isFetchPreviousPageError);
(feed.fetchNextPage(), feed.fetchPreviousPage());
```

Behaviour matches TanStack:

- A refetch (stale on mount, focus, invalidation) refetches **every loaded page
  in order**, recomputing the params from the fresh pages. The list therefore
  stays consistent.
- `maxPages` keeps at most that many pages, dropping from the opposite end.
- Fetching a page supersedes a running refetch.

Outside React, write `"next"` or `"previous"` to the atom:
`registry.set(feedQuery("effect"), "next")`.

`useSuspenseInfiniteQuery` suspends for the first page.
`usePrefetchInfiniteQuery` and `client.fetchQuery` load the first page.

To persist an infinite query, give a schema for each page and param:
`persist: { page: PageSchema, pageParam: Schema.Number }`.
