import { Query, useQuery } from "@effect-atom-query/react";
import { useState } from "react";
import { flightQuery, pollUnlessPermanent } from "../queries.ts";
import { FailureBanner, FetchDot, RetryIndicator } from "./status.tsx";

export interface FlightPanelProps {
  readonly flightNo: string | undefined;
  readonly onLookup: (flightNo: string) => void;
}

export function FlightPanel({ flightNo, onLookup }: FlightPanelProps) {
  const [draft, setDraft] = useState("");
  // No flight selected: `skipToken` disables the query, with no `enabled` flag to keep in sync.
  const flight = useQuery(flightQuery(flightNo ?? Query.skipToken), {
    refetchInterval: pollUnlessPermanent("3 seconds"),
  });

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>
          Flight {flightNo ?? ""} <FetchDot active={flight.isFetching} />
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim() !== "") onLookup(draft.trim().toUpperCase());
          }}
        >
          <input
            aria-label="Flight number"
            placeholder="e.g. KL123 or XX999"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            size={16}
          />{" "}
          <button>Look up</button>
        </form>
      </header>

      <RetryIndicator result={flight} />
      {flight.isError && <FailureBanner result={flight} />}
      {flightNo === undefined ? (
        <p className="muted">Pick a flight on the board, or look one up.</p>
      ) : flight.isPending ? (
        <p className="muted">Loading {flightNo}…</p>
      ) : flight.data._tag === "Some" ? (
        <dl className="detail">
          <dt>Route</dt>
          <dd>
            {flight.data.value.from} → {flight.data.value.to}
          </dd>
          <dt>Airline</dt>
          <dd>{flight.data.value.airline}</dd>
          <dt>Aircraft</dt>
          <dd>{flight.data.value.aircraft}</dd>
          <dt>Status</dt>
          <dd>{flight.data.value.status}</dd>
          <dt>Altitude</dt>
          <dd>{flight.data.value.altitudeFt.toLocaleString()} ft</dd>
          <dt>Speed</dt>
          <dd>{flight.data.value.speedKts} kts</dd>
          <dt>Updated</dt>
          <dd>{new Date(flight.data.value.updatedAt).toLocaleTimeString()}</dd>
        </dl>
      ) : null}
    </section>
  );
}
