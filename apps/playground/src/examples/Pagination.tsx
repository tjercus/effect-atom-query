import { Query, usePrefetchQuery, useQuery } from "@effect-atom-query/react";
import { useState } from "react";
import { Api } from "../api.ts";
import { errorMessage, type Example, Status } from "../ui.tsx";

const projectsQuery = Query.make({
  key: (page: number) => ["projects", page],
  run: (page) => Api.use((api) => api.projects(page)),
  staleTime: "5 seconds",
});

function Pagination() {
  const [page, setPage] = useState(0);
  const result = useQuery(projectsQuery(page), { placeholderData: Query.keepPreviousData });
  const hasMore = result.isSuccess && result.data.value.hasMore;

  // Prefetch the next page so "Next" is instant.
  usePrefetchQuery(projectsQuery(hasMore ? page + 1 : Query.skipToken));

  return (
    <div>
      <p>
        Pages keep showing the previous data (dimmed) while the next one loads, and the next page is
        prefetched.
      </p>
      {result.isPending ? (
        <div>Loading...</div>
      ) : result.isError ? (
        <div>Error: {errorMessage(result)}</div>
      ) : (
        <ul style={{ opacity: result.isPlaceholderData ? 0.5 : 1 }}>
          {result.data.value.projects.map((project) => (
            <li key={project.id}>{project.name}</li>
          ))}
        </ul>
      )}
      <span>Current Page: {page + 1}</span>{" "}
      <button onClick={() => setPage((p) => Math.max(p - 1, 0))} disabled={page === 0}>
        Previous Page
      </button>{" "}
      <button
        onClick={() => {
          if (!result.isPlaceholderData && hasMore) {
            setPage((p) => p + 1);
          }
        }}
        disabled={result.isPlaceholderData || !hasMore}
      >
        Next Page
      </button>
      <div>{result.isFetching ? <span>Loading...</span> : null}</div>
      <Status result={result} />
    </div>
  );
}

export const example: Example = {
  id: "pagination",
  title: "Pagination",
  tanstack: "pagination",
  description: "Paginated queries with Query.keepPreviousData and usePrefetchQuery.",
  Component: Pagination,
};
