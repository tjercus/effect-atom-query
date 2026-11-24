import { useIsFetching, useIsMutating } from "@effect-atom-query/react";
import { useSyncExternalStore } from "react";
import { example as autoRefetching } from "./examples/AutoRefetching.tsx";
import { example as basic } from "./examples/Basic.tsx";
import { example as dependent } from "./examples/Dependent.tsx";
import { example as infiniteScroll } from "./examples/InfiniteScroll.tsx";
import { example as live } from "./examples/Live.tsx";
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
  live,
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
    <span
      className={fetching + mutating > 0 ? "global busy" : "global"}
      data-testid="global"
      aria-live="polite"
    >
      {fetching > 0 ? `fetching ${fetching}` : "idle"}
      {mutating > 0 ? ` · mutating ${mutating}` : ""}
    </span>
  );
}

export function App() {
  const hash = useHash();
  const current = examples.find((e) => e.id === hash) ?? examples[0]!;
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ⚛
          </span>
          <div className="brand-text">
            Playground
            <span className="brand-sub">effect-atom-query</span>
          </div>
        </div>
        <GlobalIndicator />
        <nav aria-label="Examples">
          <div className="nav-label">Examples</div>
          <ul className="nav">
            {examples.map((e) => (
              <li key={e.id}>
                <a href={`#${e.id}`} aria-current={e === current ? "page" : undefined}>
                  {e.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <main className="main">
        <header className="top">
          <h1>{current.title}</h1>
          <p className="muted">
            {current.description}{" "}
            <small>
              (TanStack example: <code>{current.tanstack}</code>)
            </small>
          </p>
        </header>
        <section className="panel">
          <current.Component key={current.id} />
        </section>
      </main>
    </div>
  );
}
