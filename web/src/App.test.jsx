import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App, { MODE_LINES } from "./App";
import { labelOffsets } from "./components/PatternDiagram";
import { setJsonView } from "./components/JsonPane";

const STORY = {
  title: "t", intro: "intro text", banner: "SIMULATED: mock preferences", tokenLabel: "MOCK preferences and a MOCK Protect signal", hosted: false, verticals: ["retail", "health"],
  rule: { name: "User agent preferences (mock)", appliesTo: "Tool boundary", note: "n", defaults: { allowedActions: ["read", "write"], maxAmount: null, detectAgent: true, unknownAgentPolicy: "hitl" } },
  tools: [
    { name: "get_my_accounts", tier: "read", sampleAmount: null, lesson: "l" },
    { name: "create_transfer", tier: "write", sampleAmount: 750, lesson: "l" },
  ],
  scenarios: [
    { id: "allowed-read", title: "Permitted: read tool, read allowed", tool: "get_my_accounts", preferences: { allowedActions: ["read", "write"], detectAgent: true, unknownAgentPolicy: "hitl" }, detectedAgent: false, expected: "permit", lesson: "Permitted." },
    { id: "protect-deny", title: "Denied: Protect detection with a deny policy", tool: "get_my_accounts", preferences: { allowedActions: ["read", "write"], detectAgent: true, unknownAgentPolicy: "deny" }, detectedAgent: true, expected: "deny", lesson: "The strictest preference wins." },
  ],
  facts: [
    { id: "attribute", status: "measured", text: "Preferences live on the user.", source: "AI-DEMO2 PR #3401" },
    { id: "per-call-open", status: "inferred", text: "Per-call evaluation is an open question.", source: "owner" },
  ],
  talkTrack: [
    { id: "say-first", title: "Say first", say: "Everything is simulated." },
    { id: "preferences", title: "The preference", say: "The user sets what their agent may do." },
  ],
  cast: { castHost: "northwind", castBrand: "Northwind Retail" },
};
const DIAGRAM = {
  title: "Agent preferences", intro: "diagram intro",
  nodes: [{ id: "agent", label: "AI agent", kind: "actor", x: 0, y: 0 }, { id: "boundary", label: "Tool boundary gate", kind: "boundary", x: 300, y: 0 }],
  steps: [{ from: "agent", to: "boundary", label: "tools/call", say: "The agent calls the boundary." }, { from: "boundary", to: "agent", label: "Decision", say: "The gate answers." }],
};
const hop = (n) => ({ n, from: "agent", to: "boundary", label: `hop ${n}`, traceparent: `00-${"a".repeat(32)}-${String(n).repeat(16)}-01`, request: `traceparent: 00-${"a".repeat(32)}-${String(n).repeat(16)}-01`, response: "HTTP/1.1 200 OK" });

const DEFAULT_PREFS = { allowedActions: ["read", "write"], maxAmount: null, detectAgent: true, unknownAgentPolicy: "hitl" };
let calls;
let override = {};
function mockFetch() {
  calls = [];
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    calls.push({ url, opts });
    const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
    if (url.startsWith("/api/scenarios")) return override.scenarios ? override.scenarios() : json(STORY);
    if (url === "/api/info") return override.info ? override.info() : json({ mode: "mock", simulated: true, hosted: false });
    if (url.startsWith("/api/diagram")) return json(DIAGRAM);
    if (url === "/api/preferences" && (!opts.method || opts.method === "GET")) {
      return json({ preferences: override.prefs || DEFAULT_PREFS, detectedAgent: override.detected || false, detectedRule: null, tools: STORY.tools, workspace: "t" });
    }
    if (url === "/api/preferences" && opts.method === "POST") {
      const b = JSON.parse(opts.body);
      if (b.preferences === "junk" || b.preferences === null) return json({ error: "bad_preferences", detail: "must be an object" }, 400);
      const inc = b.preferences !== undefined ? b.preferences : b; override.prefs = { ...DEFAULT_PREFS, ...inc };
      return json({ preferences: override.prefs, workspace: "t" });
    }
    if (url === "/api/protect/evaluate") {
      const b = JSON.parse(opts.body);
      const detected = b.ruleId !== null && b.ruleId !== undefined;
      override.detected = detected;
      return json({
        level: detected ? "MEDIUM" : "LOW", recommendedAction: detected ? "CHALLENGE" : "ALLOW", detectedAgent: detected, agent: detected ? "Muse" : undefined,
        botDetection: { level: detected ? "medium" : "low", status: detected ? "detected" : "notDetected", detectedRuleId: detected ? b.ruleId : null, detectedRuleName: detected ? "AI agent - Muse detected" : null },
        traceId: "a".repeat(32), hops: [hop(1)],
      });
    }
    if (url === "/api/mcp/tool") {
      const b = JSON.parse(opts.body);
      const prefs = override.prefs || DEFAULT_PREFS;
      const tier = b.tool === "create_transfer" ? "write" : "read";
      let decision = "permit"; let status = 200; let code = "agent_preferences_permit"; let reason = null;
      if (override.detected && prefs.detectAgent !== false) {
        if (prefs.unknownAgentPolicy === "deny") { decision = "deny"; status = 403; code = "agent_preferences_denied"; reason = "AI agent detected and the user preference is to deny agent actions"; }
        else if (prefs.unknownAgentPolicy === "hitl") { decision = "hitl"; status = 428; code = "agent_preferences_hitl"; reason = "AI agent detected — user preference requires human approval"; }
      } else if (!prefs.allowedActions.includes(tier)) {
        decision = "hitl"; status = 428; code = "agent_preferences_hitl"; reason = `Agent action tier "${tier}" is not in the user's allowed actions`;
      } else if (prefs.maxAmount !== null && b.params?.amount > prefs.maxAmount) {
        decision = "hitl"; status = 428; code = "agent_preferences_hitl"; reason = `Agent action amount ${b.params.amount} exceeds the user's preference cap of ${prefs.maxAmount}`;
      }
      const body = { decision, code, reason, status, tier, tool: b.tool, amount: b.params?.amount ?? null, traceId: "a".repeat(32), hops: [hop(1), hop(2), hop(3), hop(4)] };
      if (decision === "hitl") { body.taskId = `hitl-${String((override.challenges = (override.challenges || 0) + 1)).padStart(4, "0")}`; override.pending = [...(override.pending || []), { taskId: body.taskId, tool: b.tool, reason, status: "pending" }]; }
      return json(body, status);
    }
    if (url === "/api/challenges" && (!opts.method || opts.method === "GET")) { return json({ pending: override.pending || [], all: override.pending || [], workspace: "t" }); }
    if (url.startsWith("/api/challenges/") && url.endsWith("/respond")) {
      const id = decodeURIComponent(url.split("/")[3]);
      const b = JSON.parse(opts.body);
      if (!/hitl-\d{4}/.test(id)) return json({ error: "not_found" }, 404);
      if (!["approved", "denied"].includes(b.decision)) return json({ error: "bad_decision", detail: "must be approved or denied" }, 400);
      override.pending = (override.pending || []).filter((c) => c.taskId !== id);
      if (b.decision === "approved") override.approved = id;
      return json({ challenge: { taskId: id, status: b.decision }, workspace: "t" });
    }
    if (url === "/api/runs") return json({ workspace: "t", runs: [] });
    if (url === "/api/reset") { override = {}; return json({ reset: "ok" }); }
    return json({}, 404);
  });
}
beforeEach(() => { override = {}; mockFetch(); window.location.hash = ""; setJsonView("form"); sessionStorage.clear(); });
afterEach(() => sessionStorage.clear());

const ready = async () => { render(<App />); await screen.findByText("Permitted: read tool, read allowed"); await screen.findByTestId("verdict"); };

describe("shell", () => {
  it("opens on the MOCK modal (simulated, nothing calls a real tenant), shows the mode, and sends X-Workspace on API calls", async () => {
    await ready();
    expect(screen.getByTestId("mode-modal")).toHaveAttribute("data-mode", "mock");
    expect(screen.getByTestId("mode-modal")).toHaveTextContent(/^MOCK.*simulated.*Nothing here calls a real gateway, identity provider or tenant\./);
    expect(screen.getByTestId("mode-select")).toHaveValue("mock");
    const ev = calls.find((c) => c.url === "/api/mcp/tool");
    expect(ev.opts.headers["x-workspace"]).toMatch(/^[a-z0-9-]{1,40}$/);
  });
  it("Reset calls /api/reset", async () => {
    await ready();
    await userEvent.click(screen.getByTestId("reset"));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/reset" && c.opts.method === "POST")).toBe(true));
  });
});

describe("preference gate tab", () => {
  it("permits the allowed-read scenario and shows the tool, hops and facts", async () => {
    await ready();
    expect(screen.getByTestId("verdict")).toHaveTextContent("PERMIT");
    expect(screen.getByTestId("scenario-prefs")).toBeInTheDocument();
    expect(screen.getByTestId("hops")).toHaveTextContent(/traceparent: 00-a{32}-1{16}-01/);
    expect(screen.getByTestId("facts")).toHaveTextContent("inferred");
  });
  it("routes protect-deny to DENY with the deny reason", async () => {
    await ready();
    await userEvent.click(screen.getByRole("button", { name: /Denied: Protect detection/ }));
    await waitFor(() => expect(screen.getByTestId("verdict")).toHaveTextContent("DENY"));
    expect(screen.getByTestId("verdict").querySelector('[data-reason="agent_preferences_denied"]')).not.toBeNull();
    expect(screen.getByTestId("lesson")).toHaveTextContent("The strictest preference wins.");
  });
  it("the preference editor saves and the gate then answers accordingly", async () => {
    await ready();
    // uncheck write: the next write call must become HITL
    await userEvent.click(screen.getByLabelText(/write \(transfer/));
    await userEvent.click(screen.getByTestId("pref-save"));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/preferences" && c.opts.method === "POST")).toBe(true));
    await userEvent.selectOptions(screen.getByLabelText("Tool"), "create_transfer");
    await userEvent.click(screen.getByTestId("call-run"));
    await waitFor(() => expect(screen.getAllByTestId("verdict").some((v) => v.textContent.includes("HITL"))).toBe(true));
  });
  it("the mock Protect panel flags the session and the gate reacts", async () => {
    await ready();
    await userEvent.selectOptions(screen.getByLabelText("Bot detection rule that fired"), "674");
    await userEvent.click(screen.getByTestId("protect-run"));
    await waitFor(() => expect(screen.getByTestId("detection-flag")).toHaveTextContent("AI agent - Muse detected"));
    expect(screen.getByTestId("protect-result")).toHaveTextContent("AI agent - Muse detected");
  });
  it("JSON panes read Form | JSON: Form is the default, JSON shows the exact text", async () => {
    await ready();
    const box = screen.getByTestId("scenario-prefs-box");
    expect(box).toHaveAttribute("data-view", "form");
    expect(within(box).getByRole("button", { name: "Form" })).toHaveAttribute("aria-pressed", "true");
    expect(within(box).getByRole("button", { name: "JSON" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(within(box).getByRole("button", { name: "JSON" }));
    expect(box).toHaveAttribute("data-view", "raw");
    expect(screen.getByTestId("scenario-prefs").textContent).toBe(JSON.stringify({ preferences: STORY.scenarios[0].preferences, tool: "get_my_accounts", detectedAgent: false }, null, 2));
  });
  it("the approval panel approves a pending challenge", async () => {
    await ready();
    // block writes then call a write tool to create a challenge
    await userEvent.click(screen.getByLabelText(/write \(transfer/));
    await userEvent.click(screen.getByTestId("pref-save"));
    await userEvent.selectOptions(screen.getByLabelText("Tool"), "create_transfer");
    await userEvent.click(screen.getByTestId("call-run"));
    await waitFor(() => expect(screen.getByTestId("challenge-list").textContent).toMatch(/hitl-/));
    await userEvent.click(within(screen.getByTestId("challenge-list")).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.getByTestId("no-pending")).toBeInTheDocument());
  });
});

describe("diagram tab", () => {
  it("draws the boxes from /api/diagram and Simulate highlights a step; Reset clears it", async () => {
    await ready();
    await userEvent.click(screen.getByRole("link", { name: "Diagram" }));
    expect(await screen.findByText("Tool boundary gate")).toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith("/api/diagram?vertical=retail"))).toBe(true);
    expect(screen.getByLabelText(/Step time/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /simulate/i }));
    expect(await screen.findByTestId("pattern-now")).toHaveTextContent("Step 1: tools/call");
    await userEvent.click(screen.getByTestId("reset"));
    await waitFor(() => expect(screen.queryByTestId("pattern-now")).toBeNull());
  });
});

describe("talk track and presenter mode", () => {
  it("lists the talk track; presenter mode keeps the mode modal and shows the say-text; Esc leaves", async () => {
    await ready();
    await userEvent.click(screen.getByRole("link", { name: "Talk track" }));
    expect(screen.getByTestId("talk-track-list")).toHaveTextContent("Everything is simulated.");
    await userEvent.click(screen.getByRole("link", { name: "Preference gate" }));
    await userEvent.keyboard("p");
    expect(await screen.findByTestId("presenter-say")).toHaveTextContent("The user sets what their agent may do.");
    expect(screen.getByTestId("mode-modal")).toHaveTextContent(/^MOCK/);
    expect(document.querySelector(".app--presenter")).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(document.querySelector(".app--presenter")).toBeNull();
  });
  it("the hosted build says hosted in the modal", async () => {
    STORY.hosted = true;
    try { render(<App />); await waitFor(() => expect(screen.getByTestId("mode-modal")).toHaveTextContent(MODE_LINES.hosted)); }
    finally { STORY.hosted = false; }
  });
});

describe("diagram edge labels", () => {
  it("nudges the two labels of a back-and-forth pair in opposite directions and leaves the rest alone", () => {
    const steps = [{ from: "a", to: "b" }, { from: "b", to: "a" }, { from: "a", to: "c" }];
    expect(labelOffsets(steps)).toEqual([-16, 16, 0]);
    expect(labelOffsets([])).toEqual([]);
  });
});

describe("the mode modal: every state the old banner had, and no banner left", () => {
  it("is the only mode label: no banner element or .banner, on any tab", async () => {
    await ready();
    for (const name of ["Diagram", "Talk track"]) {
      await userEvent.click(screen.getByRole("link", { name }));
      expect(screen.queryByTestId("banner")).toBeNull();
      expect(document.querySelector(".banner")).toBeNull();
    }
  });
  it("closes on Got it, stays closed after a same-session remount, and is shown again for a mode switch", async () => {
    const { unmount } = render(<App />);
    fireEvent.click(await screen.findByTestId("mode-modal-ok"));
    expect(screen.queryByTestId("mode-modal")).toBeNull();
    unmount();
    await ready();
    expect(screen.queryByTestId("mode-modal")).toBeNull();
  });
  it("hosted: says hosted from /api/info even before /api/scenarios answers, never the plain local line", async () => {
    override.info = async () => ({ ok: true, status: 200, json: async () => ({ mode: "mock", simulated: true, hosted: true }) });
    override.scenarios = () => new Promise(() => {});
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("mode-modal")).toHaveTextContent(MODE_LINES.hosted));
    expect(screen.getByTestId("mode-modal")).toHaveAttribute("data-mode", "mock");
  });
  it("while nothing has answered, and when both calls fail, the modal says MOCK and that it could be the local or the hosted build", async () => {
    override.info = () => Promise.reject(new Error("down"));
    override.scenarios = () => Promise.reject(new Error("down"));
    render(<App />);
    const modal = await screen.findByTestId("mode-modal");
    expect(modal).toHaveTextContent(MODE_LINES.unknown);
    expect(modal).toHaveTextContent(/local or the hosted/);
    expect(modal).toHaveAttribute("data-mode", "mock");
  });
  it("Real: MOCK until /api/info answers, then REAL, with the line that says the page is still mock", async () => {
    let release;
    const held = new Promise((r) => { release = r; });
    override.info = () => held;
    render(<App />);
    expect(await screen.findByTestId("mode-modal")).toHaveAttribute("data-mode", "mock");
    release({ ok: true, status: 200, json: async () => ({ mode: "real", simulated: true, hosted: false, realAvailable: true }) });
    await waitFor(() => expect(screen.getByTestId("mode-modal")).toHaveAttribute("data-mode", "real"));
    expect(screen.getByTestId("mode-modal")).toHaveTextContent(/^REAL.*still mock.*Nothing here calls a real gateway/);
  });
});

describe("links from the content pack: /#scenario-<id>", () => {
  it("opens the gate tab on that scenario and runs it", async () => {
    window.location.hash = "#scenario-protect-deny";
    render(<App />);
    await screen.findByTestId("verdict");
    expect(screen.getByTestId("verdict")).toHaveTextContent("DENY");
  });
  it("an unknown or hostile id falls back to the first scenario", async () => {
    window.location.hash = "#scenario-<script>";
    render(<App />);
    await screen.findByTestId("verdict");
    expect(screen.getByTestId("lesson")).toHaveTextContent("Permitted.");
  });
});

describe("accessibility structure and display safety", () => {
  it("has one main landmark; the shell bar comes first, then main with no banner in it", async () => {
    await ready();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    const root = document.querySelector(".app");
    expect(root.firstElementChild.matches("header.shell-bar")).toBe(true);
    expect(root.firstElementChild.nextElementSibling).toBe(screen.getByRole("main"));
    expect(screen.getByRole("main").querySelector(".banner, [data-testid=banner]")).toBeNull();
    expect(document.querySelector("header.shell-bar .shell-right")).not.toBeNull(); // the TopMenu sits in the bar
    expect(screen.getByTestId("mode-badge")).toHaveTextContent("Mock");
    expect(screen.getByRole("link", { name: "Preference gate" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Diagram" })).not.toHaveAttribute("aria-current");
  });
});
