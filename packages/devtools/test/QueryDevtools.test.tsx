import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Mutation, Query, QueryClient, QueryClientProvider } from "@effect-native-query/react";
import { Effect, ManagedRuntime } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { QueryDevtools, QueryDevtoolsPanel } from "../src/index.ts";
import { formatValue } from "../src/format.ts";

const runtimes: Array<ManagedRuntime.ManagedRuntime<any, any>> = [];
const makeClient = () => {
  const runtime = ManagedRuntime.make(QueryClient.layer());
  runtimes.push(runtime);
  return runtime.runSync(QueryClient.QueryClient);
};
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.dispose();
});

describe("QueryDevtools", () => {
  it("opens from the toggle and lists queries", async () => {
    const client = makeClient();
    await Effect.runPromise(
      client.fetchQuery(Query.single({ key: ["todos", 1], run: Effect.succeed({ title: "a" }) })),
    );
    render(
      <QueryClientProvider client={client}>
        <QueryDevtools />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByLabelText("open devtools"));
    expect(await screen.findByText('["todos",1]')).toBeTruthy();
    fireEvent.click(screen.getByLabelText("close devtools"));
    expect(screen.getByLabelText("open devtools")).toBeTruthy();
  });

  it("shows details and runs actions", async () => {
    const client = makeClient();
    let n = 0;
    const counter = Query.single({ key: ["n"], run: Effect.sync(() => ++n), staleTime: "1 hour" });
    await Effect.runPromise(client.fetchQuery(counter));
    render(<QueryDevtoolsPanel client={client} />);

    fireEvent.click(await screen.findByText('["n"]'));
    const details = screen.getByLabelText("query details");
    expect(within(details).getByLabelText("query data").textContent).toBe("1");
    expect(within(details).getByText("60m")).toBeTruthy();

    fireEvent.click(within(details).getByText("Refetch"));
    await waitFor(() =>
      expect(
        within(screen.getByLabelText("query details")).getByLabelText("query data").textContent,
      ).toBe("2"),
    );

    fireEvent.click(within(screen.getByLabelText("query details")).getByText("Remove"));
    expect(await screen.findByText("No queries")).toBeTruthy();
  });

  it("filters by key", async () => {
    const client = makeClient();
    await Effect.runPromise(
      Effect.all([
        client.fetchQuery(Query.single({ key: ["users"], run: Effect.succeed(1) })),
        client.fetchQuery(Query.single({ key: ["posts"], run: Effect.succeed(2) })),
      ]),
    );
    render(<QueryDevtoolsPanel client={client} />);
    expect(await screen.findByText('["users"]')).toBeTruthy();
    fireEvent.change(screen.getByLabelText("filter"), { target: { value: "post" } });
    expect(screen.queryByText('["users"]')).toBeNull();
    expect(screen.getByText('["posts"]')).toBeTruthy();
  });

  it("lists mutations", async () => {
    const client = makeClient();
    const add = Mutation.make({
      key: ["todos", "add"],
      run: (title: string) => Effect.succeed(title),
    });
    render(<QueryDevtoolsPanel client={client} />);
    await act(() => Effect.runPromise(client.mutate(add, "milk")));
    fireEvent.click(screen.getByRole("tab", { name: /mutations/ }));
    fireEvent.click(await screen.findByText('["todos","add"]'));
    const details = screen.getByLabelText("mutation details");
    expect(within(details).getByText("success")).toBeTruthy();
    expect(within(details).getAllByText('"milk"')).toHaveLength(2); // variables and data
  });
});

describe("formatValue", () => {
  it("handles Effect data, bigints, maps and cycles", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(formatValue(10n)).toBe('"10n"');
    expect(formatValue(new Map([["k", 1]]))).toContain('"Map"');
    expect(formatValue(cyclic)).toContain("[Circular]");
  });
});
