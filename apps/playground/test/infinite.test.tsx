import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { example as infiniteScroll } from "../src/examples/InfiniteScroll.tsx";
import { example as maxPages } from "../src/examples/MaxPages.tsx";
import { failNext, renderExample, settled, STALE } from "./harness.tsx";

/**
 * happy-dom's IntersectionObserver never reports anything. This one reports
 * the sentinel as visible on every `observe` while `inView` is set, which is
 * what a real browser does while the end of the list stays in view.
 */
let inView = false;
const observers = new Set<FakeIntersectionObserver>();

class FakeIntersectionObserver {
  readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe() {
    observers.add(this);
    if (inView) {
      this.fire();
    }
  }
  unobserve() {}
  disconnect() {
    observers.delete(this);
  }
  takeRecords() {
    return [];
  }
  fire() {
    this.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

beforeEach(() => {
  inView = false;
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
});

afterEach(() => {
  observers.clear();
  vi.unstubAllGlobals();
});

/** Lets pending fetches and re-renders run. */
const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

describe("InfiniteScroll", () => {
  it("keeps the pages and stops auto-loading after a failed next page", async () => {
    const h = await renderExample(infiniteScroll);
    const container = (await screen.findByText("Item 0")).parentElement;
    await settled(h);
    await failNext(h);

    // Scroll to the end: the next page is requested and fails.
    inView = true;
    act(() => observers.forEach((o) => o.fire()));

    expect(await screen.findByText(STALE, { exact: false })).toBeTruthy();
    // The sentinel is still in view and reported again (in a browser, a
    // re-render re-observes it). Without the guard this retries at once.
    act(() => observers.forEach((o) => o.fire()));
    await flush();
    // No retry loop: that would have loaded page 1.
    expect(screen.queryByText("Item 5")).toBeNull();
    // The same scroll container stays mounted, so the scroll position survives.
    expect(screen.getByText("Item 0").parentElement).toBe(container);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Item 5")).toBeTruthy();
  });

  it("retries a failed previous page", async () => {
    const h = await renderExample(infiniteScroll);
    expect(await screen.findByText("Item 0")).toBeTruthy();
    await settled(h);
    await failNext(h);

    fireEvent.click(screen.getByRole("button", { name: "Load Older" }));
    expect(await screen.findByText(STALE, { exact: false })).toBeTruthy();
    expect(screen.queryByText("Item -5")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Item -5")).toBeTruthy();
    expect(screen.getByText("Item 0")).toBeTruthy();
  });
});

describe("MaxPages", () => {
  it("keeps the pages when the next page fails, and loads it again", async () => {
    const h = await renderExample(maxPages);
    const pageParams = await screen.findByTestId("page-params");
    expect(pageParams.textContent).toBe("[0]");
    await settled(h);
    await failNext(h);

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText(STALE, { exact: false })).toBeTruthy();
    expect(screen.getByTestId("page-params").textContent).toBe("[0]");

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await vi.waitFor(() => expect(screen.getByTestId("page-params").textContent).toBe("[0, 1]"));
  });
});
