import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import App from "../App.jsx";

// The header shows this lab's own Verified / In progress mark, read from the same /api/shelf call a Shelf link makes (through the lab-proxy that call
// reaches the shelf, whose payload lists every demo with its mark). The lab's own /api/shelf has no demos, so there is no mark then.
// This lab renders no Shelf link, so the badge sits inside the top menu.
const mark = (status, label, extra = {}) => ({ status, label, note: "", updatedAt: "2026-11-15", source: "shipped", ...extra });
function withShelf(payload) {
  globalThis.fetch = vi.fn(async (url) => {
    if (url === "/api/shelf") return { ok: true, status: 200, json: async () => payload };
    return { ok: false, status: 404, json: async () => ({}) };
  });
}
const loaded = async () => { await screen.findByRole("tablist"); return within(await screen.findByTestId("top-menu")); };

beforeEach(() => { window.location.hash = ""; });
afterEach(() => { vi.restoreAllMocks(); });

describe("verification mark in the header", () => {
  it("shows this lab's own mark in the top menu, and no other lab's; the note is the tooltip", async () => {
    withShelf({ shelfUrl: "http://shelf.example", demos: [
      { id: "other-lab", verification: mark("in-progress", "In progress") },
      { id: "agent-preferences-lab", verification: mark("verified", "Verified", { note: "Every gate decision run on the mock" }) },
    ] });
    render(<App />);
    const bar = await loaded();
    expect(await bar.findByText("Verified")).toBeInTheDocument();
    expect(bar.queryByText("In progress")).toBeNull();
    expect(document.querySelectorAll(".verify")).toHaveLength(1);
    expect(bar.getByText("Verified").closest(".verify")).toHaveAttribute("title", expect.stringContaining("Every gate decision run on the mock"));
  });

  it("shows the In progress mark when that is the lab's mark", async () => {
    withShelf({ shelfUrl: "http://shelf.example", demos: [{ id: "agent-preferences-lab", verification: mark("in-progress", "In progress") }] });
    render(<App />);
    const bar = await loaded();
    expect(await bar.findByText("In progress")).toBeInTheDocument();
    expect(document.querySelectorAll(".verify")).toHaveLength(1);
  });

  it("shows nothing when the lab is opened on its own port (its /api/shelf has no demos), the shelf has no mark for it, or the mark is none", async () => {
    for (const payload of [
      { shelfUrl: "http://shelf.example" },
      { shelfUrl: "http://shelf.example", demos: [{ id: "agent-preferences-lab", verification: null }] },
      { shelfUrl: "http://shelf.example", demos: [{ id: "agent-preferences-lab", verification: mark("none", "") }] },
    ]) {
      withShelf(payload);
      const { unmount } = render(<App />);
      await loaded();
      await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith("/api/shelf", expect.anything()));
      await new Promise((r) => setTimeout(r, 20));
      expect(document.querySelector(".verify")).toBeNull();
      unmount();
    }
  });
});
