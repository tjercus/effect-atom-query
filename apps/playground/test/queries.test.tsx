import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { example as basic } from "../src/examples/Basic.tsx";
import { example as dependent } from "../src/examples/Dependent.tsx";
import { example as pagination } from "../src/examples/Pagination.tsx";
import { example as prefetching } from "../src/examples/Prefetching.tsx";
import { FAILED, failRefetch, renderExample, STALE } from "./harness.tsx";

describe("Basic", () => {
  it("shows the error when the first load fails", async () => {
    await renderExample(basic, { failFirstRequest: true });
    expect(await screen.findByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(STALE, { exact: false })).toBeNull();
  });

  it("keeps the posts when a refetch fails", async () => {
    const h = await renderExample(basic);
    expect(await screen.findByText("Post 1: notes on Atlas")).toBeTruthy();
    await failRefetch(h, ["posts"]);
    expect(await screen.findByText(STALE, { exact: false })).toBeTruthy();
    expect(screen.getByText("Post 1: notes on Atlas")).toBeTruthy();
  });

  it("keeps a post when its refetch fails", async () => {
    const h = await renderExample(basic);
    fireEvent.click(await screen.findByText("Post 2: notes on Borealis"));
    expect(await screen.findByRole("heading", { name: "Post 2: notes on Borealis" })).toBeTruthy();
    await failRefetch(h, ["post", 2]);
    expect(await screen.findByText(STALE, { exact: false })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Post 2: notes on Borealis" })).toBeTruthy();
  });
});

describe("Dependent", () => {
  it("keeps the projects query disabled while there is no user", async () => {
    await renderExample(dependent, { failFirstRequest: true });
    expect(await screen.findByText(`User: ${FAILED.replace("Error: ", "")}`)).toBeTruthy();
    expect(screen.getByText("Projects: waiting for the user…")).toBeTruthy();
  });

  it("waits for the user, then loads their projects", async () => {
    await renderExample(dependent);
    // ada@example.com gets id 15 from the fake server.
    expect(await screen.findByText("User: ada (#15)")).toBeTruthy();
    expect(
      await screen.findByText("Projects: Atlas for #15, Borealis for #15, Cygnus for #15"),
    ).toBeTruthy();
  });
});

describe("Pagination", () => {
  it("keeps the page when its refetch fails", async () => {
    const h = await renderExample(pagination);
    expect(await screen.findByText("Project 1")).toBeTruthy();
    // Waits for the prefetch of the next page too, so only page 0 refetches.
    await failRefetch(h, ["projects", 0]);
    expect(await screen.findByText(STALE, { exact: false })).toBeTruthy();
    expect(screen.getByText("Project 1")).toBeTruthy();
  });
});

describe("Prefetching", () => {
  it("shows a failed list load as a list item", async () => {
    await renderExample(prefetching, { failFirstRequest: true });
    const item = await screen.findByText(FAILED);
    expect(item.tagName).toBe("LI");
  });

  it("keeps the details when their refetch fails", async () => {
    const h = await renderExample(prefetching);
    // Click only: hovering prefetches on the app runtime, not the harness.
    fireEvent.click(await screen.findByText("K-7 Pathfinder"));
    expect(await screen.findByRole("heading", { name: "K-7 Pathfinder" })).toBeTruthy();
    await failRefetch(h, ["character", 2]);
    expect(await screen.findByText(STALE, { exact: false })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "K-7 Pathfinder" })).toBeTruthy();
  });
});
