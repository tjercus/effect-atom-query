import {
  Query,
  QueryErrorResetBoundary,
  useSuspenseQueries,
  useSuspenseQuery,
} from "@effect-atom-query/react";
import { Component, type ReactNode, Suspense, useState } from "react";
import { Api } from "../api.ts";
import { runtime } from "../runtime.ts";
import type { Example } from "../ui.tsx";

const projectsQuery = Query.make({
  key: (page: number) => ["suspense", "projects", page],
  run: (page) => Api.use((api) => api.projects(page)),
});

const postQuery = Query.make({
  key: (id: number) => ["suspense", "post", id],
  run: (id) => Api.use((api) => api.post(id)),
});

function Projects() {
  // `data` is always present: loading suspends, errors go to the boundary.
  const projects = useSuspenseQuery(projectsQuery(0));
  return (
    <ul>
      {projects.data.value.projects.map((p) => (
        <li key={p.id}>{p.name}</li>
      ))}
    </ul>
  );
}

function Posts() {
  // Fetched in parallel, not as a waterfall.
  const [a, b] = useSuspenseQueries({ queries: [postQuery(1), postQuery(2)] });
  return (
    <ul>
      <li>{a.data.value.title}</li>
      <li>{b.data.value.title}</li>
    </ul>
  );
}

class ErrorBoundary extends Component<
  { readonly onReset: () => void; readonly children: ReactNode },
  { error: unknown }
> {
  override state = { error: undefined as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override render() {
    if (this.state.error === undefined) return this.props.children;
    return (
      <div style={{ color: "#dc2626" }}>
        <p>
          There was an error:{" "}
          {(this.state.error as { readonly message?: string }).message ?? "unknown error"}
        </p>
        <button
          onClick={() => {
            this.props.onReset();
            this.setState({ error: undefined });
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}

function SuspenseExample() {
  const [shown, setShown] = useState(false);
  return (
    <div>
      <p>
        Suspense with an error boundary. Arm a failure, then show the queries (cleared first) to see
        the boundary and its reset.
      </p>
      <button onClick={() => setShown((s) => !s)}>{shown ? "Hide" : "Show"} queries</button>{" "}
      <button onClick={() => runtime.runFork(Api.use((api) => api.failNext))}>
        Fail next request
      </button>
      {shown ? (
        <QueryErrorResetBoundary>
          {({ reset }) => (
            <ErrorBoundary onReset={reset}>
              <Suspense fallback={<p>Loading projects…</p>}>
                <Projects />
                <Suspense fallback={<p>Loading posts…</p>}>
                  <Posts />
                </Suspense>
              </Suspense>
            </ErrorBoundary>
          )}
        </QueryErrorResetBoundary>
      ) : null}
    </div>
  );
}

export const example: Example = {
  id: "suspense",
  title: "Suspense",
  tanstack: "suspense",
  description:
    "useSuspenseQuery / useSuspenseQueries with QueryErrorResetBoundary. Hiding the queries lets them be garbage collected after gcTime.",
  Component: SuspenseExample,
};
