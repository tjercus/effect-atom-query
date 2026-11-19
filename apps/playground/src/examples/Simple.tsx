import { Query, QueryResult, useQuery } from "@effect-atom-query/react";
import { Api } from "../api.ts";
import type { Example } from "../ui.tsx";

const repoQuery = Query.single({
  key: ["repoData"],
  run: Api.use((api) => api.repo),
});

function Simple() {
  const repo = useQuery(repoQuery);
  return QueryResult.match(repo, {
    onPending: () => <p>Loading...</p>,
    onFailure: () => <p>An error has occurred</p>,
    onSuccess: (success) => {
      const { name, stars, forks, watchers } = success.data.value;
      return (
        <div>
          <h3>{name}</h3>
          <p>
            👀 {watchers} ✨ {stars} 🍴 {forks}
          </p>
          <p>{success.isFetching ? "Updating..." : ""}</p>
        </div>
      );
    },
  });
}

export const example: Example = {
  id: "simple",
  title: "Simple",
  tanstack: "simple",
  description: "One query defined at module level with a service-backed Effect.",
  Component: Simple,
};
