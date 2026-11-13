import {
  InfiniteQuery,
  QueryErrorResetBoundary,
  useSuspenseInfiniteQuery,
} from "@effect-native-query/react";
import { Effect, Option } from "effect";
import { Component, type ReactNode, Suspense } from "react";

// A fake cursor API: 4 pages of 3 posts, 400 ms latency.
const feedQuery = InfiniteQuery.make({
  key: (topic: string) => ["feed", topic],
  run: (topic, cursor: number) =>
    Effect.succeed({
      posts: Array.from({ length: 3 }, (_, i) => `${topic} post ${cursor * 3 + i + 1}`),
      next: cursor < 3 ? Option.some(cursor + 1) : Option.none<number>(),
    }).pipe(Effect.delay("400 millis")),
  initialPageParam: 0,
  getNextPageParam: (page) => page.next,
});

function Posts() {
  const feed = useSuspenseInfiniteQuery(feedQuery("effect"));
  return (
    <>
      <ul data-testid="posts">
        {feed.data.value.pages
          .flatMap((page) => page.posts)
          .map((post) => (
            <li key={post}>{post}</li>
          ))}
      </ul>
      <button
        type="button"
        disabled={!feed.hasNextPage || feed.isFetchingNextPage}
        onClick={feed.fetchNextPage}
      >
        {feed.isFetchingNextPage
          ? "loading more…"
          : feed.hasNextPage
            ? "load more"
            : "no more posts"}
      </button>
    </>
  );
}

class Boundary extends Component<
  { readonly onReset: () => void; readonly children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <button
        type="button"
        onClick={() => {
          this.props.onReset();
          this.setState({ failed: false });
        }}
      >
        try again
      </button>
    );
  }
}

export function Feed() {
  return (
    <section>
      <h2>Feed (Suspense + infinite)</h2>
      <QueryErrorResetBoundary>
        {({ reset }) => (
          <Boundary onReset={reset}>
            <Suspense fallback={<p data-testid="feed-fallback">loading feed…</p>}>
              <Posts />
            </Suspense>
          </Boundary>
        )}
      </QueryErrorResetBoundary>
    </section>
  );
}
