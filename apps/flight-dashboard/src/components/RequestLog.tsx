import type { RequestOutcome } from "../api/layers.ts";
import { requestLog, useStore } from "../store.ts";

const label = (outcome: RequestOutcome): string => {
  switch (outcome._tag) {
    case "Ok":
      return "ok";
    case "Failed":
      return outcome.error;
    case "Defect":
      return "defect";
    case "Cancelled":
      return "cancelled";
  }
};

/** Written by `layerRequestLog`, which wraps whichever backend is active. */
export function RequestLog() {
  const entries = useStore(requestLog);
  return (
    <section className="panel log">
      <header className="panel-head">
        <h2>Request log</h2>
        <button onClick={() => requestLog.set(() => [])} disabled={entries.length === 0}>
          Clear
        </button>
      </header>
      {entries.length === 0 ? (
        <p className="muted">No requests yet.</p>
      ) : (
        <ol>
          {entries.map((e) => (
            <li
              key={`${e.startedAt}-${e.id}`}
              className={`outcome ${e.outcome._tag.toLowerCase()}`}
            >
              <span className="badge">{label(e.outcome)}</span>
              <span>{e.request}</span>
              <small className="muted">{e.millis} ms</small>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
