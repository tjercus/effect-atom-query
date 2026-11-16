import { useQuery } from "@effect-atom-query/react";
import { airports, type Airport, type Flight } from "../api/domain.ts";
import { departuresQuery, pollUnlessPermanent } from "../queries.ts";
import { FailureBanner, FetchDot, RetryIndicator } from "./status.tsx";

export interface DeparturesBoardProps {
  readonly airport: Airport;
  readonly onAirport: (airport: Airport) => void;
  readonly selected: string | undefined;
  readonly onSelect: (flightNo: string) => void;
}

export function DeparturesBoard({ airport, onAirport, selected, onSelect }: DeparturesBoardProps) {
  // Polls every 5 s while mounted and the tab is visible.
  const board = useQuery(departuresQuery(airport), {
    refetchInterval: pollUnlessPermanent("5 seconds"),
  });

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>
          Departures <FetchDot active={board.isFetching} />
        </h2>
        <div className="tabs" role="tablist">
          {airports.map((a) => (
            <button
              key={a}
              role="tab"
              aria-selected={a === airport}
              className={a === airport ? "active" : ""}
              onClick={() => onAirport(a)}
            >
              {a}
            </button>
          ))}
        </div>
        <button onClick={() => board.refetch()} disabled={board.isFetching}>
          Refresh
        </button>
      </header>

      <RetryIndicator result={board} />

      {/* Data first: a failed poll keeps the last good board on screen, with the error above it. */}
      {board.isError && <FailureBanner result={board} />}
      {board.isPending ? (
        <p className="muted">Loading departures from {airport}…</p>
      ) : board.data._tag === "Some" ? (
        <FlightTable flights={board.data.value} selected={selected} onSelect={onSelect} />
      ) : null}
    </section>
  );
}

export function FlightTable({
  flights,
  selected,
  onSelect,
}: {
  readonly flights: ReadonlyArray<Flight>;
  readonly selected?: string | undefined;
  readonly onSelect: (flightNo: string) => void;
}) {
  return (
    <table className="board">
      <thead>
        <tr>
          <th>Time</th>
          <th>Flight</th>
          <th>To</th>
          <th>Gate</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {flights.map((f) => (
          <tr key={f.flightNo} className={f.flightNo === selected ? "selected" : ""}>
            <td>{f.scheduled}</td>
            <td>
              <button className="link" onClick={() => onSelect(f.flightNo)}>
                {f.flightNo}
              </button>{" "}
              <small className="muted">{f.airline}</small>
            </td>
            <td>{f.to}</td>
            <td>{f.gate}</td>
            <td>
              <span className={`status ${f.status.toLowerCase()}`}>
                {f.status}
                {f.status === "Delayed" ? ` +${f.delayMinutes}m` : ""}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
