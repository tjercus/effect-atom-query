import { Query, useQuery, useQueryClient, useRunEffect } from "@effect-atom-query/react";
import { Equal } from "effect";
import { useState } from "react";
import { searchQuery } from "../queries.ts";
import { FlightTable } from "./DeparturesBoard.tsx";
import { FailureBanner, FetchDot, RetryIndicator } from "./status.tsx";

export function FlightSearch({ onSelect }: { readonly onSelect: (flightNo: string) => void }) {
  const [term, setTerm] = useState("");
  const client = useQueryClient();
  const runEffect = useRunEffect();
  const results = useQuery(searchQuery(term.trim() === "" ? Query.skipToken : term));

  /**
   * Cancellation is fiber interruption. Interrupting a search's fiber stops
   * everything it was doing: the retry schedule, the chaos delay, and the HTTP
   * request (watch it turn "(canceled)" in the Network tab).
   */
  const cancel = (filters: Parameters<typeof client.cancelQueries>[0]) =>
    void runEffect.promise(client.cancelQueries(filters));

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>
          Search <FetchDot active={results.isFetching} />
        </h2>
        <input
          aria-label="Search flights"
          placeholder="flight, airline or destination"
          value={term}
          onChange={(e) => {
            const next = e.target.value;
            // A keystroke that changes the key supersedes the running search, so stop it.
            const previousKey = searchQuery.key(term);
            if (term.trim() !== "" && !Equal.equals(previousKey, searchQuery.key(next))) {
              cancel({ queryKey: previousKey, exact: true });
            }
            setTerm(next);
          }}
        />
        <button onClick={() => cancel({ queryKey: ["search"] })} disabled={!results.isFetching}>
          Cancel
        </button>
      </header>

      <RetryIndicator result={results} />
      {results.isError && <FailureBanner result={results} />}
      {term.trim() === "" ? (
        <p className="muted">
          Type quickly: every keystroke interrupts the search before it. Searches take three times
          as long as other requests.
        </p>
      ) : results.isPending ? (
        <p className="muted">{results.isFetching ? `Searching “${term}”…` : "Cancelled."}</p>
      ) : results.data._tag === "Some" ? (
        results.data.value.length === 0 ? (
          <p className="muted">No flights match “{term}”.</p>
        ) : (
          <FlightTable flights={results.data.value} onSelect={onSelect} />
        )
      ) : null}
    </section>
  );
}
