import { Query, useIsFetching, useQuery } from "@effect-native-query/react";
import { Effect, Option, Schema } from "effect";
import { useState } from "react";
import { Todos } from "./Todos.tsx";

class PageNotFound extends Schema.TaggedError<PageNotFound>()("PageNotFound", {
  page: Schema.Number,
}) {}

interface Page {
  readonly page: number;
  readonly items: ReadonlyArray<string>;
  readonly fetchedAt: string;
}

// A fake paginated API: 300 ms latency, five pages.
const pageQuery = Query.make({
  key: (page: number) => ["items", { page }],
  run: (page) =>
    Effect.gen(function* () {
      yield* Effect.sleep("300 millis");
      if (page > 5) return yield* new PageNotFound({ page });
      return {
        page,
        items: Array.from({ length: 5 }, (_, i) => `item ${(page - 1) * 5 + i + 1}`),
        fetchedAt: new Date().toLocaleTimeString(),
      } satisfies Page;
    }),
  staleTime: "10 seconds",
  retry: false,
});

const selectItems = (page: Page) => page.items;

function Items() {
  const [page, setPage] = useState(1);
  const result = useQuery(pageQuery(page), { placeholderData: Query.keepPreviousData });
  const items = useQuery(pageQuery(page), { select: selectItems });

  return (
    <section style={{ opacity: result.isPlaceholderData ? 0.5 : 1 }}>
      <h2>Page {page}</h2>
      {result.isPending ? <p>Loading…</p> : null}
      {result.isError ? (
        <p>
          Error: {Option.match(result.error, { onNone: () => "defect", onSome: (e) => e._tag })}
        </p>
      ) : null}
      {result.isSuccess ? (
        <>
          <ul>
            {result.data.value.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <small>
            fetched at {result.data.value.fetchedAt} · stale: {String(result.isStale)} · selected{" "}
            {items.isSuccess ? items.data.value.length : 0} items
          </small>
        </>
      ) : null}
      <p>
        <button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          previous
        </button>{" "}
        <button type="button" onClick={() => setPage((p) => p + 1)}>
          next
        </button>{" "}
        <button type="button" onClick={result.refetch}>
          refetch
        </button>
      </p>
    </section>
  );
}

// Polls every second while the tab is visible; pauses offline (networkMode "online").
const serverClock = Query.single({
  key: ["server-clock"],
  run: Effect.sync(() => new Date().toLocaleTimeString()).pipe(Effect.delay("100 millis")),
  refetchInterval: "1 second",
});

function Clock() {
  const clock = useQuery(serverClock);
  return (
    <p data-testid="clock">
      clock: {clock.isSuccess ? clock.data.value : "…"} ({clock.fetchStatus})
    </p>
  );
}

export function App() {
  const fetching = useIsFetching();
  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 480, margin: "2rem auto" }}>
      <h1>effect-native-query playground</h1>
      <p>{fetching > 0 ? `fetching ${fetching}…` : "idle"}</p>
      <Clock />
      <Todos />
      <Items />
    </main>
  );
}
