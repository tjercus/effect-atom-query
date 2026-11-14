import { useIsFetching, useIsMutating } from "@effect-native-query/react";
import { useSyncExternalStore } from "react";
import { example as autoRefetching } from "./examples/AutoRefetching.tsx";
import { example as basic } from "./examples/Basic.tsx";
import { example as dependent } from "./examples/Dependent.tsx";
import { example as infiniteScroll } from "./examples/InfiniteScroll.tsx";
import { example as maxPages } from "./examples/MaxPages.tsx";
import { example as offline } from "./examples/Offline.tsx";
import { example as optimisticCache } from "./examples/OptimisticCache.tsx";
import { example as optimisticUi } from "./examples/OptimisticUi.tsx";
import { example as pagination } from "./examples/Pagination.tsx";
import { example as prefetching } from "./examples/Prefetching.tsx";
import { example as simple } from "./examples/Simple.tsx";
import { example as suspense } from "./examples/Suspense.tsx";
import type { Example } from "./ui.tsx";

export const examples: ReadonlyArray<Example> = [
  simple,
  basic,
  pagination,
  infiniteScroll,
  maxPages,
  dependent,
  prefetching,
  autoRefetching,
  optimisticUi,
  optimisticCache,
  suspense,
  offline,
];

const subscribeHash = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};
const useHash = () => useSyncExternalStore(subscribeHash, () => window.location.hash.slice(1));

function GlobalIndicator() {
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  return (
    <small style={{ color: "#64748b" }} data-testid="global">
      {fetching > 0 ? `fetching ${fetching}` : "idle"}
      {mutating > 0 ? ` · mutating ${mutating}` : ""}
    </small>
  );
}

export function App() {
  const hash = useHash();
  const current = examples.find((e) => e.id === hash) ?? examples[0]!;
  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        display: "flex",
        flexWrap: "wrap",
        gap: 24,
        maxWidth: 960,
        margin: "0 auto",
        padding: "16px 16px 45vh",
      }}
    >
      <nav style={{ flex: "0 0 220px" }}>
        <h1 style={{ fontSize: 18 }}>effect-native-query</h1>
        <GlobalIndicator />
        <ul style={{ listStyle: "none", padding: 0 }}>
          {examples.map((e) => (
            <li key={e.id} style={{ margin: "4px 0" }}>
              <a href={`#${e.id}`} style={{ fontWeight: e === current ? 700 : 400 }}>
                {e.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <main style={{ flex: "1 1 400px", minWidth: 0 }}>
        <h2 style={{ marginTop: 0 }}>{current.title}</h2>
        <p style={{ color: "#475569" }}>
          {current.description}{" "}
          <small>
            (TanStack example: <code>{current.tanstack}</code>)
          </small>
        </p>
        <hr />
        <current.Component key={current.id} />
      </main>
    </div>
  );
}
