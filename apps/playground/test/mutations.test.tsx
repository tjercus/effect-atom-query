import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { example as optimisticCache } from "../src/examples/OptimisticCache.tsx";
import { example as optimisticUi } from "../src/examples/OptimisticUi.tsx";
import { FAILED, failRefetch, renderExample, STALE } from "./harness.tsx";

/** Submits a todo the fake server rejects: it rejects texts containing "fail". */
const addRejectedTodo = async () => {
  fireEvent.change(await screen.findByLabelText("todo"), { target: { value: "please fail" } });
  fireEvent.submit(screen.getByLabelText("todo").closest("form")!);
};

describe("OptimisticCache", () => {
  it("shows the error when the first load fails", async () => {
    await renderExample(optimisticCache, { failFirstRequest: true });
    expect(await screen.findByText(FAILED)).toBeTruthy();
  });

  it("rolls back a rejected todo", async () => {
    await renderExample(optimisticCache);
    expect(await screen.findByText("learn Effect")).toBeTruthy();
    await addRejectedTodo();
    expect(await screen.findByText(/Rejected "please fail" — rolled back\./)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("please fail")).toBeNull());
    expect(screen.getByText("learn Effect")).toBeTruthy();
  });
});

describe("OptimisticUi", () => {
  it("shows the error, not an empty list, when the first load fails", async () => {
    await renderExample(optimisticUi, { failFirstRequest: true });
    expect(await screen.findByText(FAILED)).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("keeps the list and shows the error when a refetch fails", async () => {
    const h = await renderExample(optimisticUi);
    expect(await screen.findByText("learn Effect")).toBeTruthy();
    await failRefetch(h, ["todos", "optimistic-ui"]);
    expect(await screen.findByText(STALE, { exact: false })).toBeTruthy();
    expect(screen.getByText("learn Effect")).toBeTruthy();
  });

  it("drops a rejected todo and offers a retry", async () => {
    await renderExample(optimisticUi);
    expect(await screen.findByText("learn Effect")).toBeTruthy();
    await addRejectedTodo();
    expect(await screen.findByText(/Rejected "please fail"/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText("please fail")).toBeNull();
    expect(screen.getByText("learn Effect")).toBeTruthy();
  });
});
