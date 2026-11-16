import { QueryDevtools } from "@effect-atom-query/devtools";
import { QueryClientProvider, useIsFetching } from "@effect-atom-query/react";
import { useState } from "react";
import type { Airport } from "./api/domain.ts";
import { BackendSwitcher } from "./components/BackendSwitcher.tsx";
import { DeparturesBoard } from "./components/DeparturesBoard.tsx";
import { FlightPanel } from "./components/FlightPanel.tsx";
import { FlightSearch } from "./components/FlightSearch.tsx";
import { PanelBoundary } from "./components/PanelBoundary.tsx";
import { RequestLog } from "./components/RequestLog.tsx";
import { type AppRuntime, type BackendChoice, makeRuntime } from "./runtime.ts";

export interface Selection {
  readonly airport: Airport;
  readonly flightNo: string | undefined;
}

/** Everything below the provider. It does not know which backend serves it. */
export function Dashboard({
  selection: { airport, flightNo },
  onSelection,
}: {
  readonly selection: Selection;
  readonly onSelection: (f: (s: Selection) => Selection) => void;
}) {
  const setAirport = (a: Airport) => onSelection((s) => ({ ...s, airport: a }));
  const setFlightNo = (no: string) => onSelection((s) => ({ ...s, flightNo: no }));
  const fetching = useIsFetching();
  return (
    <>
      <p className="muted global" data-testid="global">
        {fetching > 0 ? `${fetching} queries fetching` : "idle"}
      </p>
      <div className="grid">
        <PanelBoundary title="Departures">
          <DeparturesBoard
            airport={airport}
            onAirport={setAirport}
            selected={flightNo}
            onSelect={setFlightNo}
          />
        </PanelBoundary>
        <div className="stack">
          <PanelBoundary title="Flight">
            <FlightPanel flightNo={flightNo} onLookup={setFlightNo} />
          </PanelBoundary>
          <PanelBoundary title="Search">
            <FlightSearch onSelect={setFlightNo} />
          </PanelBoundary>
        </div>
      </div>
    </>
  );
}

const initialChoice: BackendChoice = { backend: "http", chaos: false };

export function App() {
  const [{ choice, runtime }, setState] = useState<{
    readonly choice: BackendChoice;
    readonly runtime: AppRuntime;
  }>(() => ({ choice: initialChoice, runtime: makeRuntime(initialChoice) }));
  // Kept above the provider, so the selection survives a backend swap.
  const [selection, setSelection] = useState<Selection>({ airport: "AMS", flightNo: undefined });

  // Swapping the backend builds a new runtime (and so a new QueryClient) from
  // other layers. This happens in the event handler, not in render or an effect,
  // so StrictMode's double invocation cannot dispose a runtime that is in use.
  const swap = (next: BackendChoice) => {
    const previous = runtime;
    setState({ choice: next, runtime: makeRuntime(next) });
    // After React has switched to the new provider: disposing interrupts every
    // fiber of the old runtime, including requests still in flight.
    setTimeout(() => void previous.dispose(), 0);
  };

  return (
    <div className="app">
      <header className="top">
        <h1>Flight dashboard</h1>
        <p className="muted">
          An <code>effect-atom-query</code> example. The components below are the same whichever
          backend layer you pick.
        </p>
      </header>
      <BackendSwitcher choice={choice} onChange={swap} />
      <QueryClientProvider runtime={runtime}>
        <Dashboard selection={selection} onSelection={setSelection} />
        <QueryDevtools />
      </QueryClientProvider>
      <RequestLog />
    </div>
  );
}
