import { type QueryClient, QueryInspector } from "@effect-atom-query/query";
import { useQueryClient } from "@effect-atom-query/react";
import { Option } from "effect";
import * as React from "react";
import { formatAgo, formatDuration, formatValue, type QueryLabel, queryLabel } from "./format.ts";

/**
 * @since 0.1.0
 * @category models
 */
export interface QueryDevtoolsPanelProps {
  /** Defaults to the client of the nearest `QueryClientProvider`. */
  readonly client?: QueryClient.Service | undefined;
  readonly style?: React.CSSProperties | undefined;
  readonly onClose?: (() => void) | undefined;
}

/**
 * @since 0.1.0
 * @category models
 */
export interface QueryDevtoolsProps extends Omit<QueryDevtoolsPanelProps, "onClose" | "style"> {
  readonly initialIsOpen?: boolean | undefined;
  readonly position?: "bottom-right" | "bottom-left" | "top-right" | "top-left" | undefined;
  /** Panel height when open. Default `"40vh"`. */
  readonly height?: string | undefined;
}

const palette: Record<QueryLabel | "idle" | "pending" | "success", string> = {
  fresh: "#16a34a",
  fetching: "#2563eb",
  paused: "#9333ea",
  error: "#dc2626",
  stale: "#ca8a04",
  inactive: "#6b7280",
  idle: "#6b7280",
  pending: "#2563eb",
  success: "#16a34a",
};

const font = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const styles = {
  panel: {
    display: "flex",
    flexDirection: "column",
    background: "#0f172a",
    color: "#e2e8f0",
    font: `12px/1.4 ${font}`,
    boxSizing: "border-box",
    minHeight: 0,
  },
  header: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
    padding: "6px 8px",
    borderBottom: "1px solid #1e293b",
  },
  body: { display: "flex", flex: 1, minHeight: 0 },
  list: { flex: "1 1 50%", overflow: "auto", borderRight: "1px solid #1e293b", minWidth: 0 },
  detail: { flex: "1 1 50%", overflow: "auto", padding: 8, minWidth: 0 },
  row: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    width: "100%",
    padding: "4px 8px",
    background: "transparent",
    color: "inherit",
    border: 0,
    borderBottom: "1px solid #1e293b",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
  },
  badge: {
    display: "inline-block",
    minWidth: 18,
    padding: "0 4px",
    borderRadius: 4,
    color: "#fff",
    textAlign: "center",
    fontWeight: 600,
  },
  button: {
    background: "#1e293b",
    color: "inherit",
    border: "1px solid #334155",
    borderRadius: 4,
    padding: "2px 8px",
    font: "inherit",
    cursor: "pointer",
  },
  input: {
    background: "#1e293b",
    color: "inherit",
    border: "1px solid #334155",
    borderRadius: 4,
    padding: "2px 6px",
    font: "inherit",
    minWidth: 0,
    flex: "1 1 120px",
  },
  pre: {
    margin: 0,
    padding: 8,
    background: "#020617",
    borderRadius: 4,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
  },
  dl: {
    display: "grid",
    gridTemplateColumns: "max-content 1fr",
    gap: "2px 12px",
    margin: "0 0 8px",
  },
} satisfies Record<string, React.CSSProperties>;

interface Snapshot {
  readonly queries: ReadonlyArray<QueryInspector.QuerySnapshot>;
  readonly mutations: ReadonlyArray<QueryInspector.MutationSnapshot>;
  readonly now: number;
}

/** Cache snapshots, refreshed on cache changes and every second (for staleness). */
const useSnapshot = (client: QueryClient.Service): Snapshot => {
  const store = React.useMemo(() => {
    let current: Snapshot | undefined;
    const read = (): Snapshot => {
      current ??= {
        queries: QueryInspector.queries(client),
        mutations: QueryInspector.mutations(client),
        now: Date.now(),
      };
      return current;
    };
    return {
      read,
      subscribe: (onChange: () => void) => {
        const refresh = () => {
          current = undefined;
          onChange();
        };
        const unsubscribe = QueryInspector.subscribe(client, refresh);
        const timer = setInterval(refresh, 1000);
        return () => {
          unsubscribe();
          clearInterval(timer);
        };
      },
    };
  }, [client]);
  return React.useSyncExternalStore(store.subscribe, store.read, store.read);
};

const Badge = ({ color, children }: { color: string; children: React.ReactNode }) => (
  <span style={{ ...styles.badge, background: color }}>{children}</span>
);

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <>
    <dt style={{ color: "#94a3b8" }}>{label}</dt>
    <dd style={{ margin: 0 }}>{children}</dd>
  </>
);

const QueryDetail = ({
  client,
  query,
  now,
}: {
  client: QueryClient.Service;
  query: QueryInspector.QuerySnapshot;
  now: number;
}) => {
  const label = queryLabel(query);
  const act = (action: QueryInspector.Action) =>
    QueryInspector.run(client, QueryInspector.action(client, query.key, action));
  return (
    <div aria-label="query details">
      <pre style={{ ...styles.pre, marginBottom: 8 }}>{query.hash}</pre>
      <dl style={styles.dl}>
        <Field label="status">
          <Badge color={palette[label]}>{label}</Badge> {query.status} / {query.fetchStatus}
        </Field>
        <Field label="observers">{query.observers}</Field>
        <Field label="updated">
          {Option.match(query.dataUpdatedAt, {
            onNone: () => "never",
            onSome: (t) => formatAgo(t, now),
          })}{" "}
          ({query.dataUpdateCount}×)
        </Field>
        <Field label="staleTime">{formatDuration(query.staleTime)}</Field>
        <Field label="gcTime">{formatDuration(query.gcTime)}</Field>
        {query.failureCount > 0 && <Field label="failures">{query.failureCount}</Field>}
        {query.isDisabled && <Field label="disabled">yes</Field>}
        {query.isInvalidated && <Field label="invalidated">yes</Field>}
        {query.persisted && <Field label="persisted">yes</Field>}
      </dl>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
        <button style={styles.button} onClick={() => act("refetch")}>
          Refetch
        </button>
        <button style={styles.button} onClick={() => act("invalidate")}>
          Invalidate
        </button>
        <button style={styles.button} onClick={() => act("reset")}>
          Reset
        </button>
        {query.fetchStatus !== "idle" && (
          <button style={styles.button} onClick={() => act("cancel")}>
            Cancel
          </button>
        )}
        <button style={styles.button} onClick={() => act("remove")}>
          Remove
        </button>
      </div>
      {Option.isSome(query.error) && (
        <>
          <div style={{ color: palette.error, margin: "4px 0" }}>Error</div>
          <pre style={styles.pre}>{query.error.value}</pre>
        </>
      )}
      <div style={{ color: "#94a3b8", margin: "4px 0" }}>Data</div>
      <pre style={styles.pre} aria-label="query data">
        {Option.match(query.data, { onNone: () => "(none)", onSome: formatValue })}
      </pre>
      {Option.isSome(query.meta) && (
        <>
          <div style={{ color: "#94a3b8", margin: "4px 0" }}>Meta</div>
          <pre style={styles.pre}>{formatValue(query.meta.value)}</pre>
        </>
      )}
    </div>
  );
};

const MutationDetail = ({
  mutation,
  now,
}: {
  mutation: QueryInspector.MutationSnapshot;
  now: number;
}) => (
  <div aria-label="mutation details">
    <dl style={styles.dl}>
      <Field label="key">
        {Option.match(mutation.key, { onNone: () => "—", onSome: formatValue })}
      </Field>
      <Field label="status">
        <Badge color={mutation.isPaused ? palette.paused : palette[mutation.status]}>
          {mutation.isPaused ? "paused" : mutation.status}
        </Badge>
      </Field>
      <Field label="submitted">
        {Option.match(mutation.submittedAt, {
          onNone: () => "—",
          onSome: (t) => formatAgo(t, now),
        })}
      </Field>
      {mutation.failureCount > 0 && <Field label="failures">{mutation.failureCount}</Field>}
    </dl>
    <div style={{ color: "#94a3b8", margin: "4px 0" }}>Variables</div>
    <pre style={styles.pre}>
      {Option.match(mutation.variables, { onNone: () => "(none)", onSome: formatValue })}
    </pre>
    {Option.isSome(mutation.error) && (
      <>
        <div style={{ color: palette.error, margin: "4px 0" }}>Error</div>
        <pre style={styles.pre}>{mutation.error.value}</pre>
      </>
    )}
    <div style={{ color: "#94a3b8", margin: "4px 0" }}>Data</div>
    <pre style={styles.pre}>
      {Option.match(mutation.data, { onNone: () => "(none)", onSome: formatValue })}
    </pre>
  </div>
);

const labelOrder: Record<QueryLabel, number> = {
  error: 0,
  fetching: 1,
  paused: 2,
  stale: 3,
  fresh: 4,
  inactive: 5,
};

/**
 * The devtools panel, for embedding anywhere (e.g. in a resizable pane).
 *
 * @since 0.1.0
 * @category components
 */
export const QueryDevtoolsPanelImpl = (props: QueryDevtoolsPanelProps) => {
  const contextClient = useOptionalQueryClient();
  const client = props.client ?? contextClient;
  if (client === undefined) {
    throw new Error("QueryDevtools needs a `client` prop or a QueryClientProvider");
  }
  return <Panel {...props} client={client} />;
};

const Panel = ({
  client,
  style,
  onClose,
}: QueryDevtoolsPanelProps & { client: QueryClient.Service }) => {
  const { queries, mutations, now } = useSnapshot(client);
  const [tab, setTab] = React.useState<"queries" | "mutations">("queries");
  const [filter, setFilter] = React.useState("");
  const [sort, setSort] = React.useState<"status" | "key" | "updated">("status");
  const [selected, setSelected] = React.useState<string | number | undefined>(undefined);

  const shownQueries = React.useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const list = queries.filter((q) => needle === "" || q.hash.toLowerCase().includes(needle));
    return list.slice().sort((a, b) => {
      if (sort === "key") return a.hash.localeCompare(b.hash);
      if (sort === "updated")
        return (
          Option.getOrElse(b.dataUpdatedAt, () => 0) - Option.getOrElse(a.dataUpdatedAt, () => 0)
        );
      return labelOrder[queryLabel(a)] - labelOrder[queryLabel(b)] || a.hash.localeCompare(b.hash);
    });
  }, [queries, filter, sort]);

  const shownMutations = React.useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return mutations
      .filter(
        (m) =>
          needle === "" ||
          Option.match(m.key, { onNone: () => "", onSome: (k) => JSON.stringify(k) })
            .toLowerCase()
            .includes(needle),
      )
      .slice()
      .reverse();
  }, [mutations, filter]);

  const counts = React.useMemo(() => {
    const c: Record<QueryLabel, number> = {
      fresh: 0,
      fetching: 0,
      paused: 0,
      error: 0,
      stale: 0,
      inactive: 0,
    };
    for (const q of queries) c[queryLabel(q)]++;
    return c;
  }, [queries]);

  const selectedQuery = tab === "queries" ? queries.find((q) => q.hash === selected) : undefined;
  const selectedMutation =
    tab === "mutations" ? mutations.find((m) => m.id === selected) : undefined;

  return (
    <div
      style={{ ...styles.panel, ...style }}
      role="region"
      aria-label="effect-atom-query devtools"
    >
      <div style={styles.header}>
        <strong>effect-atom-query</strong>
        <div role="tablist" style={{ display: "flex", gap: 4 }}>
          {(["queries", "mutations"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              style={{ ...styles.button, borderColor: tab === t ? "#60a5fa" : "#334155" }}
              onClick={() => {
                setTab(t);
                setSelected(undefined);
              }}
            >
              {t} ({t === "queries" ? queries.length : mutations.length})
            </button>
          ))}
        </div>
        {tab === "queries" && (
          <span style={{ display: "flex", gap: 4 }}>
            {(Object.keys(counts) as Array<QueryLabel>).map((label) => (
              <span key={label} title={label}>
                <Badge color={palette[label]}>{counts[label]}</Badge>
              </span>
            ))}
          </span>
        )}
        <input
          style={styles.input}
          placeholder="Filter by key"
          aria-label="filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {tab === "queries" && (
          <select
            style={styles.button}
            aria-label="sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
          >
            <option value="status">sort: status</option>
            <option value="key">sort: key</option>
            <option value="updated">sort: updated</option>
          </select>
        )}
        {tab === "queries" ? (
          <button
            style={styles.button}
            onClick={() => QueryInspector.run(client, client.clear)}
            title="Remove every query and mutation"
          >
            Clear
          </button>
        ) : null}
        {onClose && (
          <button style={styles.button} onClick={onClose} aria-label="close devtools">
            ✕
          </button>
        )}
      </div>
      <div style={styles.body}>
        <div style={styles.list} role="list">
          {tab === "queries"
            ? shownQueries.map((q) => {
                const label = queryLabel(q);
                return (
                  <button
                    key={q.hash}
                    role="listitem"
                    style={{
                      ...styles.row,
                      background: q.hash === selected ? "#1e293b" : "transparent",
                    }}
                    onClick={() => setSelected(q.hash)}
                    title={label}
                  >
                    <Badge color={palette[label]}>{q.observers}</Badge>
                    <span
                      style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {q.hash}
                    </span>
                  </button>
                );
              })
            : shownMutations.map((m) => (
                <button
                  key={m.id}
                  role="listitem"
                  style={{
                    ...styles.row,
                    background: m.id === selected ? "#1e293b" : "transparent",
                  }}
                  onClick={() => setSelected(m.id)}
                >
                  <Badge color={m.isPaused ? palette.paused : palette[m.status]}>
                    {m.isPaused ? "paused" : m.status}
                  </Badge>
                  <span>
                    {Option.match(m.key, {
                      onNone: () => `#${m.id}`,
                      onSome: (k) => JSON.stringify(k),
                    })}
                  </span>
                </button>
              ))}
          {(tab === "queries" ? shownQueries.length : shownMutations.length) === 0 && (
            <div style={{ padding: 8, color: "#94a3b8" }}>No {tab}</div>
          )}
        </div>
        <div style={styles.detail}>
          {selectedQuery ? (
            <QueryDetail client={client} query={selectedQuery} now={now} />
          ) : selectedMutation ? (
            <MutationDetail mutation={selectedMutation} now={now} />
          ) : (
            <span style={{ color: "#94a3b8" }}>
              Select a {tab === "queries" ? "query" : "mutation"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

/** The provider's client, or `undefined` outside a provider. */
const useOptionalQueryClient = (): QueryClient.Service | undefined => {
  try {
    return useQueryClient();
  } catch {
    return undefined;
  }
};

const corner = (position: NonNullable<QueryDevtoolsProps["position"]>): React.CSSProperties => {
  const [v, h] = position.split("-") as ["top" | "bottom", "left" | "right"];
  return { [v]: 12, [h]: 12 };
};

/**
 * A floating toggle button that opens the devtools panel docked to the
 * bottom (or top) of the viewport.
 *
 * @since 0.1.0
 * @category components
 */
export const QueryDevtoolsImpl = ({
  initialIsOpen = false,
  position = "bottom-right",
  height = "40vh",
  client,
}: QueryDevtoolsProps) => {
  const [open, setOpen] = React.useState(initialIsOpen);
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="open devtools"
        style={{
          ...styles.button,
          position: "fixed",
          zIndex: 99999,
          ...corner(position),
          background: "#0f172a",
          color: "#e2e8f0",
          font: `12px ${font}`,
          padding: "6px 10px",
          boxShadow: "0 2px 8px rgba(0,0,0,.3)",
        }}
      >
        ⚡ queries
      </button>
    );
  }
  return (
    <QueryDevtoolsPanelImpl
      client={client}
      onClose={() => setOpen(false)}
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        [position.startsWith("top") ? "top" : "bottom"]: 0,
        height,
        zIndex: 99999,
        boxShadow: "0 -2px 12px rgba(0,0,0,.3)",
      }}
    />
  );
};
