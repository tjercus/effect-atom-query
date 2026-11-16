import { useIsFetching, useQuery, useQueryClient, useRunEffect } from "@effect-atom-query/react";
import { Equal } from "effect";
import { useState } from "react";
import { searchQuery } from "../queries.ts";
import { FlightTable } from "./DeparturesBoard.tsx";
import { PanelBoundary } from "./PanelBoundary.tsx";
import { FailureBanner, FetchDot, RetryIndicator } from "./status.tsx";

/**
 * The search box stays outside the error boundary, so a defect replaces only
 * the results: you can keep typing, and a new term clears the crash.
 */
export function FlightSearch({ onSelect }: { readonly onSelect: (flightNo: string) => void }) {
  const [term, setTerm] = useState("");
  const client = useQueryClient();
  const runEffect = useRunEffect();
  // Counts without subscribing to the result, so a defect does not throw here.
  const fetching = useIsFetching({ queryKey: ["search"] });

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>
          Search <FetchDot active={fetching > 0} />
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
              void runEffect.promise(client.cancelQueries({ queryKey: previousKey, exact: true }));
            }
            setTerm(next);
          }}
        />
      </header>

      {term.trim() === "" ? (
        <p className="muted">
          Type quickly: every keystroke interrupts the search before it. Searches take three times
          as long as other requests.
        </p>
      ) : (
        // Keyed by term: typing something new starts with a fresh boundary.
        <PanelBoundary key={term} title="Search" inline>
          <SearchResults term={term} onSelect={onSelect} />
        </PanelBoundary>
      )}
    </section>
  );
}

function SearchResults({
  term,
  onSelect,
}: {
  readonly term: string;
  readonly onSelect: (flightNo: string) => void;
}) {
  const client = useQueryClient();
  const runEffect = useRunEffect();
  const results = useQuery(searchQuery(term));

  /**
   * Cancellation is fiber interruption. Interrupting a search's fiber stops
   * everything it was doing: the retry schedule, the chaos delay, and the HTTP
   * request (watch it turn "(canceled)" in the Network tab).
   */
  const cancel = () => void runEffect.promise(client.cancelQueries({ queryKey: ["search"] }));

  return (
    <>
      <div className="search-status">
        {results.isPending ? (
          <p className="muted">
            {results.isFetching
              ? `Searching “${term}”…`
              : results.isPaused
                ? `Waiting for the network to search “${term}”…`
                : "Cancelled."}
          </p>
        ) : null}
        {/* A paused search (offline) is still queued and resumes on reconnect, so it can be cancelled too. */}
        <button onClick={cancel} disabled={!results.isFetching && !results.isPaused}>
          Cancel
        </button>
      </div>
      <RetryIndicator result={results} />
      {results.isError && <FailureBanner result={results} />}
      {results.data._tag === "Some" ? (
        results.data.value.length === 0 ? (
          <p className="muted">No flights match “{term}”.</p>
        ) : (
          <FlightTable flights={results.data.value} onSelect={onSelect} />
        )
      ) : null}
    </>
  );
}
