import { useIsFetching } from "@effect-atom-query/react";
import type { RequestOutcome } from "../api/layers.ts";
import { requestLog, useStore } from "../store.ts";

const kinds: ReadonlyArray<RequestOutcome["_tag"]> = ["Ok", "Failed", "Defect", "Cancelled"];

/** Headline numbers from the request log and the query cache. */
export function Stats() {
  const fetching = useIsFetching();
  const entries = useStore(requestLog);
  const count = (tag: RequestOutcome["_tag"]) =>
    entries.filter((e) => e.outcome._tag === tag).length;
  const failed = count("Failed") + count("Defect");
  const settled = entries.filter((e) => e.outcome._tag !== "Cancelled");
  const millis = settled.map((e) => e.millis).toSorted((a, b) => a - b);
  const median = millis.length === 0 ? undefined : millis[Math.floor(millis.length / 2)];

  return (
    <div className="stats">
      <div className="stat">
        <span className="stat-label">In flight</span>
        <strong className="stat-value">{fetching}</strong>
        <span className="muted" data-testid="global">
          {fetching > 0 ? `${fetching} queries fetching` : "idle"}
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">Requests</span>
        <strong className="stat-value">{entries.length}</strong>
        <div className="mix" aria-label="Outcomes of recent requests">
          {kinds.map((tag) => {
            const n = count(tag);
            return n === 0 ? null : (
              <span
                key={tag}
                className={`mix-part ${tag.toLowerCase()}`}
                style={{ flexGrow: n }}
                title={`${tag}: ${n}`}
              />
            );
          })}
        </div>
      </div>
      <div className="stat">
        <span className="stat-label">Failed</span>
        <strong className="stat-value">{failed}</strong>
        <span className="muted">
          {entries.length === 0 ? "—" : `${Math.round((failed / entries.length) * 100)}% of recent`}
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">Median latency</span>
        <strong className="stat-value">
          {median ?? "—"}
          {median !== undefined && <small> ms</small>}
        </strong>
        <span className="muted">
          last {entries.length} {entries.length === 1 ? "request" : "requests"}
        </span>
      </div>
    </div>
  );
}
