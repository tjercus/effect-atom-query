import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  Mutation,
  Query,
  QueryClient,
  QueryClientProvider,
  QueryInspector,
} from "@effect-atom-query/react";
import { Deferred, Effect, ManagedRuntime, Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { QueryDevtools, QueryDevtoolsPanel } from "../src/index.ts";

const runtimes: Array<ManagedRuntime.ManagedRuntime<any, any>> = [];
const makeClient = () => {
  const runtime = ManagedRuntime.make(QueryClient.layer());
  runtimes.push(runtime);
  return runtime.runSync(QueryClient.QueryClient);
};
afterEach(async () => {
  vi.restoreAllMocks();
  for (const runtime of runtimes.splice(0)) await runtime.dispose();
});

const details = () => screen.getByLabelText("query details");
const rowTexts = () =>
  screen.getAllByRole("listitem").map((row) => row.querySelectorAll("span")[1]!.textContent);

describe("query details", () => {
  it("shows the error, failure count and meta of a failed query", async () => {
    const client = makeClient();
    await Effect.runPromise(
      client
        .fetchQuery(
          Query.single({
            key: ["broken"],
            run: Effect.fail("kaput"),
            retry: false,
            meta: { owner: "billing" },
          }),
        )
        .pipe(Effect.ignore),
    );
    render(<QueryDevtoolsPanel client={client} />);
    fireEvent.click(await screen.findByText('["broken"]'));
    const panel = details();
    expect(within(panel).getByText("error", { selector: "span" })).toBeTruthy();
    expect(within(panel).getByText("Error")).toBeTruthy();
    expect(within(panel).getByText(/kaput/)).toBeTruthy();
    expect(within(panel).getByText("failures")).toBeTruthy();
    expect(within(panel).getByText(/^never/)).toBeTruthy();
    expect(within(panel).getByLabelText("query data").textContent).toBe("(none)");
    expect(within(panel).getByText("Meta")).toBeTruthy();
    expect(within(panel).getByText(/"owner": "billing"/)).toBeTruthy();
  });

  it("offers Cancel only while a query is fetching", async () => {
    const client = makeClient();
    const slow = Query.single({ key: ["slow"], run: Effect.never });
    QueryInspector.run(client, client.prefetchQuery(slow));
    render(<QueryDevtoolsPanel client={client} />);
    fireEvent.click(await screen.findByText('["slow"]'));
    expect(within(details()).getByText(/pending \/ fetching/)).toBeTruthy();
    fireEvent.click(within(details()).getByText("Cancel"));
    await waitFor(() => expect(within(details()).queryByText("Cancel")).toBeNull());
    expect(within(details()).getByText(/pending \/ idle/)).toBeTruthy();
  });

  it("invalidates and resets a query", async () => {
    const client = makeClient();
    await Effect.runPromise(client.setQueryData(["seeded"], { v: 1 }));
    render(<QueryDevtoolsPanel client={client} />);
    fireEvent.click(await screen.findByText('["seeded"]'));
    expect(within(details()).queryByText("invalidated")).toBeNull();

    fireEvent.click(within(details()).getByText("Invalidate"));
    expect(await within(details()).findByText("invalidated")).toBeTruthy();

    fireEvent.click(within(details()).getByText("Reset"));
    await waitFor(() =>
      expect(within(details()).getByLabelText("query data").textContent).toBe("(none)"),
    );
  });

  it("marks persisted queries", async () => {
    const client = makeClient();
    await Effect.runPromise(
      client.fetchQuery(
        Query.single({
          key: ["saved"],
          run: Effect.succeed(1),
          persist: { schema: Schema.Number },
        }),
      ),
    );
    render(<QueryDevtoolsPanel client={client} />);
    fireEvent.click(await screen.findByText('["saved"]'));
    expect(within(details()).getByText("persisted")).toBeTruthy();
  });
});

describe("panel header", () => {
  it("sorts by status, key and last update", async () => {
    const client = makeClient();
    await Effect.runPromise(client.setQueryData(["b"], 1));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await Effect.runPromise(client.setQueryData(["c"], 2));
    await Effect.runPromise(
      client
        .fetchQuery(Query.single({ key: ["a-error"], run: Effect.fail("x"), retry: false }))
        .pipe(Effect.ignore),
    );
    render(<QueryDevtoolsPanel client={client} />);
    await screen.findByText('["b"]');

    // status: errors first, then the (inactive) rest by key
    expect(rowTexts()).toEqual(['["a-error"]', '["b"]', '["c"]']);

    fireEvent.change(screen.getByLabelText("sort"), { target: { value: "updated" } });
    expect(rowTexts()).toEqual(['["c"]', '["b"]', '["a-error"]']);

    fireEvent.change(screen.getByLabelText("sort"), { target: { value: "key" } });
    expect(rowTexts()).toEqual(['["a-error"]', '["b"]', '["c"]']);
  });

  it("counts queries per status", async () => {
    const client = makeClient();
    await Effect.runPromise(
      Effect.all([client.setQueryData(["x"], 1), client.setQueryData(["y"], 2)]),
    );
    render(<QueryDevtoolsPanel client={client} />);
    await screen.findByText('["x"]');
    const count = (label: string) =>
      screen.getAllByTitle(label).find((el) => el.tagName === "SPAN")!.textContent;
    expect(count("inactive")).toBe("2");
    expect(count("error")).toBe("0");
    expect(count("fresh")).toBe("0");
  });

  it("clears the cache", async () => {
    const client = makeClient();
    await Effect.runPromise(client.setQueryData(["gone"], 1));
    render(<QueryDevtoolsPanel client={client} />);
    await screen.findByText('["gone"]');
    fireEvent.click(screen.getByText("Clear"));
    expect(await screen.findByText("No queries")).toBeTruthy();
  });

  it("shows tab-specific controls and placeholders", async () => {
    const client = makeClient();
    render(<QueryDevtoolsPanel client={client} />);
    expect(screen.getByText("No queries")).toBeTruthy();
    expect(screen.getByText("Select a query")).toBeTruthy();
    expect(screen.getByLabelText("sort")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /mutations/ }));
    expect(screen.getByRole("tab", { name: /mutations/ }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByText("No mutations")).toBeTruthy();
    expect(screen.getByText("Select a mutation")).toBeTruthy();
    expect(screen.queryByLabelText("sort")).toBeNull();
    expect(screen.queryByText("Clear")).toBeNull();
  });
});

describe("mutation details", () => {
  it("shows keyless and failed mutations", async () => {
    const client = makeClient();
    const fail = Mutation.make({ run: (n: number) => Effect.fail(`rejected ${n}`), retry: false });
    render(<QueryDevtoolsPanel client={client} />);
    await act(() => Effect.runPromise(client.mutate(fail, 7).pipe(Effect.ignore)));
    fireEvent.click(screen.getByRole("tab", { name: /mutations/ }));
    const row = await screen.findByText(/^#\d+$/);
    fireEvent.click(row);
    const panel = screen.getByLabelText("mutation details");
    expect(within(panel).getByText("—")).toBeTruthy(); // no key
    expect(within(panel).getByText("error")).toBeTruthy();
    expect(within(panel).getByText(/rejected/)).toBeTruthy();
    expect(within(panel).getByText("7")).toBeTruthy();
    expect(within(panel).getByText("(none)")).toBeTruthy(); // no data
    expect(within(panel).getByText(/s ago$/)).toBeTruthy();

    // Keyless mutations never match a non-empty filter.
    fireEvent.change(screen.getByLabelText("filter"), { target: { value: "x" } });
    expect(screen.getByText("No mutations")).toBeTruthy();
  });

  it("shows a mutation queued behind its scope as paused", async () => {
    const client = makeClient();
    const gate = Effect.runSync(Deferred.make<void>());
    const save = Mutation.make({
      key: ["save"],
      scope: "doc",
      run: (title: string) => Deferred.await(gate).pipe(Effect.as(title)),
    });
    render(<QueryDevtoolsPanel client={client} />);
    act(() => {
      QueryInspector.run(client, client.mutate(save, "first").pipe(Effect.asVoid));
      QueryInspector.run(client, client.mutate(save, "second").pipe(Effect.asVoid));
    });
    fireEvent.click(screen.getByRole("tab", { name: /mutations/ }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    // newest first
    const [second, first] = screen.getAllByRole("listitem");
    expect(within(second!).getByText("paused")).toBeTruthy();
    expect(within(first!).getByText("pending")).toBeTruthy();

    fireEvent.click(second!);
    const panel = screen.getByLabelText("mutation details");
    expect(within(panel).getByText("paused")).toBeTruthy();
    expect(within(panel).getByText('"second"')).toBeTruthy();

    await act(() => Effect.runPromise(Deferred.succeed(gate, undefined)));
    await waitFor(() => expect(within(panel).getByText("success")).toBeTruthy());
  });
});

describe("error handling", () => {
  const brokenClient = (state: { fail: unknown }) => {
    const client = makeClient();
    const cache = new Proxy(client.cache, {
      get: (target, prop, receiver) =>
        prop === "all"
          ? () => {
              if (state.fail !== undefined) throw state.fail;
              return target.all();
            }
          : Reflect.get(target, prop, receiver),
    });
    return { ...client, cache } as QueryClient.Service;
  };

  it("contains a crash, then reloads and closes the panel", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const state: { fail: unknown } = { fail: new Error("cache exploded") };
    const onClose = vi.fn();
    render(<QueryDevtoolsPanel client={brokenClient(state)} onClose={onClose} />);
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("effect-atom-query devtools crashed")).toBeTruthy();
    expect(within(alert).getByText("cache exploded")).toBeTruthy();

    fireEvent.click(within(alert).getByText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);

    state.fail = undefined;
    fireEvent.click(within(alert).getByText("Reload panel"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("No queries")).toBeTruthy();
  });

  it("formats non-Error crashes and omits Close without onClose", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<QueryDevtoolsPanel client={brokenClient({ fail: { code: 42 } })} />);
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText(/"code": 42/)).toBeTruthy();
    expect(within(alert).queryByText("Close")).toBeNull();
  });

  it("requires a client prop or a provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<QueryDevtoolsPanel />)).toThrow(/needs a `client` prop/);
  });
});

describe("QueryDevtools toggle", () => {
  it("places the toggle in the requested corner", () => {
    const client = makeClient();
    render(
      <QueryClientProvider client={client}>
        <QueryDevtools position="top-left" />
      </QueryClientProvider>,
    );
    const toggle = screen.getByLabelText("open devtools");
    expect(toggle.style.top).toBe("12px");
    expect(toggle.style.left).toBe("12px");
    expect(toggle.style.bottom).toBe("");
  });

  it("can start open, docked to the top with a custom height", () => {
    const client = makeClient();
    render(<QueryDevtools client={client} initialIsOpen position="top-right" height="200px" />);
    const panel = screen.getByRole("region", { name: "effect-atom-query devtools" });
    expect(panel.style.top).toBe("0px");
    expect(panel.style.height).toBe("200px");
    fireEvent.click(screen.getByLabelText("close devtools"));
    expect(screen.getByLabelText("open devtools").style.right).toBe("12px");
  });
});

describe("production builds", () => {
  it("render nothing when NODE_ENV is production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    try {
      const prod = await import("../src/index.ts");
      const client = makeClient();
      const { container } = render(
        <>
          <prod.QueryDevtools client={client} initialIsOpen />
          <prod.QueryDevtoolsPanel client={client} />
        </>,
      );
      expect(container.innerHTML).toBe("");
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
