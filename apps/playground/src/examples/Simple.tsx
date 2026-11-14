import { Query, useQuery } from "@effect-atom-query/react";
import { Api } from "../api.ts";
import type { Example } from "../ui.tsx";

const repoQuery = Query.single({
  key: ["repoData"],
  run: Api.use((api) => api.repo),
});

function Simple() {
  const repo = useQuery(repoQuery);
  if (repo.isPending) return <p>Loading...</p>;
  if (repo.isError) return <p>An error has occurred</p>;
  const { name, stars, forks, watchers } = repo.data.value;
  return (
    <div>
      <h3>{name}</h3>
      <p>
        👀 {watchers} ✨ {stars} 🍴 {forks}
      </p>
      <p>{repo.isFetching ? "Updating..." : ""}</p>
    </div>
  );
}

export const example: Example = {
  id: "simple",
  title: "Simple",
  tanstack: "simple",
  description: "One query defined at module level with a service-backed Effect.",
  Component: Simple,
};
