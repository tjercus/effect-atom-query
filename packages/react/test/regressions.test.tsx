/**
 * Regression tests for defects found in the pre-release review (2026-11-14).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { Effect, Option } from "effect";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  Query,
  QueryClientProvider,
  QueryErrorResetBoundary,
  useQueries,
  useQuery,
  useSuspenseQueries,
  useSuspenseQuery,
} from "../src/index.ts";
import { counter, makeClient, RetryBoundary, wrapper } from "./utils.tsx";

const disposers: Array<() => Promise<void>> = [];
const setup = () => {
  const c = makeClient();
  disposers.push(c.dispose);
  return c;
};
afterEach(async () => {
  vi.restoreAllMocks();
  for (const dispose of disposers.splice(0)) {
    await dispose();
  }
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("changes between render and subscribe", () => {
  it("useQuery sees a write made in a sibling's layout effect (real root, no act)", async () => {
    const actEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined })
      .IS_REACT_ACT_ENVIRONMENT;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined }).IS_REACT_ACT_ENVIRONMENT =
      false;
    const { client } = setup();
    const q = Query.single({
      key: ["gap"],
      run: Effect.succeed(1),
      enabled: false,
      staleTime: "static",
    });
    function A() {
      const r = useQuery(q);
      return <p>A:{Option.isSome(r.data) ? String(r.data.value) : "none"}</p>;
    }
    function B() {
      React.useLayoutEffect(() => {
        Effect.runSync(client.setQueryData(q, 5));
      }, []);
      return null;
    }
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    try {
      React.startTransition(() => {
        root.render(
          <QueryClientProvider client={client}>
            <A />
            <B />
          </QueryClientProvider>,
        );
      });
      await sleep(100);
      expect(el.textContent).toBe("A:5");
    } finally {
      root.unmount();
      el.remove();
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined }).IS_REACT_ACT_ENVIRONMENT =
        actEnvironment;
    }
  });

  it("useQueries sees a write made in a sibling's layout effect", async () => {
    const { client } = setup();
    const q = Query.single({ key: ["gap2"], run: Effect.succeed(1), enabled: false });
    function A() {
      const [r] = useQueries({ queries: [q] });
      return <p>A:{Option.isSome(r.data) ? String(r.data.value) : "none"}</p>;
    }
    function B() {
      React.useLayoutEffect(() => {
        Effect.runSync(client.setQueryData(q, 5));
      }, []);
      return null;
    }
    render(
      <>
        <A />
        <B />
      </>,
      { wrapper: wrapper(client) },
    );
    await sleep(50);
    expect(screen.getByText(/A:/).textContent).toBe("A:5");
  });
});

describe("suspense", () => {
  it("after an error-boundary reset, suspends instead of rendering without data", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = setup();
    let fail = true;
    const seen: Array<string> = [];
    const q = Query.single({
      key: ["s-reset"],
      run: Effect.suspend(() =>
        fail ? Effect.fail("broken" as const) : Effect.succeed({ t: "fixed" }),
      ).pipe(Effect.delay("10 millis")),
      retry: false,
    });
    function Value() {
      const r = useSuspenseQuery(q);
      seen.push(r.data._tag);
      return <p>{r.data.value.t}</p>;
    }
    render(
      <QueryClientProvider client={client}>
        <QueryErrorResetBoundary>
          {({ reset }) => (
            <RetryBoundary onReset={reset}>
              <React.Suspense fallback={<p>loading</p>}>
                <Value />
              </React.Suspense>
            </RetryBoundary>
          )}
        </QueryErrorResetBoundary>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("caught: broken")).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByText("retry"));
    expect(await screen.findByText("fixed")).toBeTruthy();
    expect(seen).not.toContain("None");
  });

  it("suspense hooks run queries whose definition is disabled", async () => {
    const { client } = setup();
    const q = Query.single({ key: ["sq-dis"], run: Effect.succeed({ t: "x" }), enabled: false });
    const seen: Array<string> = [];
    function V() {
      const [r] = useSuspenseQueries({ queries: [q] });
      seen.push(r.data._tag);
      return <p>{r.data.value.t}</p>;
    }
    render(
      <React.Suspense fallback={<p>loading</p>}>
        <V />
      </React.Suspense>,
      { wrapper: wrapper(client) },
    );
    expect(await screen.findByText("x")).toBeTruthy();
    expect(seen).not.toContain("None");
  });
});

describe("throwOnError", () => {
  it("a predicate that returns false does not block the retry on remount", async () => {
    const { client } = setup();
    const runs = counter();
    const q = Query.single({
      key: ["pred"],
      run: Effect.suspend(() => {
        runs.next();
        return Effect.fail("404" as const);
      }),
      retry: false,
    });
    function V() {
      const r = useQuery(q, { throwOnError: (e) => e !== "404" });
      return (
        <p>
          {r.status}/{String(r.isFetching)}
        </p>
      );
    }
    const { unmount } = render(<V />, { wrapper: wrapper(client) });
    expect(await screen.findByText("error/false")).toBeTruthy();
    unmount();
    render(<V />, { wrapper: wrapper(client) });
    await sleep(50);
    expect(runs.count).toBe(2);
  });
});
