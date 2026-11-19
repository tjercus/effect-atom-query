import { Query, QueryResult, useQuery } from "@effect-atom-query/react";
import { useState } from "react";
import { Api } from "../api.ts";
import { errorMessage, type Example } from "../ui.tsx";

const userQuery = Query.make({
  key: (email: string) => ["user", email],
  run: (email) => Api.use((api) => api.userByEmail(email)),
});

const projectsQuery = Query.make({
  key: (userId: number) => ["projects-of", userId],
  run: (userId) => Api.use((api) => api.projectsOf(userId)),
});

function Dependent() {
  const [email, setEmail] = useState("ada@example.com");
  const user = useQuery(userQuery(email));
  // Disabled (skipToken) until the user is known: no `undefined` id needed.
  const projects = useQuery(
    QueryResult.match(user, {
      onPending: () => projectsQuery(Query.skipToken),
      onFailure: () => projectsQuery(Query.skipToken),
      onSuccess: (success) => projectsQuery(success.data.value.id),
    }),
  );

  return (
    <div>
      <label>
        Email: <input value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <p>
        User:{" "}
        {QueryResult.match(user, {
          onPending: () => "loading…",
          onFailure: errorMessage,
          onSuccess: (success) => `${success.data.value.name} (#${success.data.value.id})`,
        })}
      </p>
      <p>
        Projects:{" "}
        {QueryResult.match(projects, {
          // A disabled query (skipToken) is pending too.
          onPending: (pending) => (pending.isEnabled ? "loading…" : "waiting for the user…"),
          onFailure: errorMessage,
          onSuccess: (success) => success.data.value.map((p) => p.name).join(", "),
        })}
      </p>
    </div>
  );
}

export const example: Example = {
  id: "dependent",
  title: "Dependent queries",
  tanstack: "dependent queries guide",
  description: "Query.skipToken keeps the second query disabled until the first has data.",
  Component: Dependent,
};
