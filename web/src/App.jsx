import { useCallback, useEffect, useState } from "react";
import PreferencesGate from "./components/PreferencesGate";
import DiagramTab from "./components/DiagramTab";
import TalkTrack from "./components/TalkTrack";
import TopMenu, { applyFontSize } from "./top-menu/TopMenu";
import VerifyMark from "./components/VerifyMark.jsx";
import { getJson, resetWorkspace, setMode } from "./api";

export const TABS = [
  { id: "gate", label: "Preference gate" },
  { id: "diagram", label: "Diagram" },
  { id: "talk", label: "Talk track" },
];
// The banner is never blank and never claims "not hosted" before it knows: until /api/info or /api/scenarios answers (or if both fail)
// it says both, honestly.
const TAIL = "Nothing here calls a real gateway, identity provider or tenant.";
export const BANNER_UNKNOWN = `SIMULATED / HOSTED SIMULATION: mock preferences, a mock Protect signal and a mock tool boundary. ${TAIL}`;
const BANNER_LOCAL = `SIMULATED: mock preferences, a mock Protect signal and a mock tool boundary. ${TAIL}`;
const BANNER_HOSTED = `HOSTED SIMULATION: mock preferences, a mock Protect signal and a mock tool boundary. ${TAIL}`;
const THEMES = ["auto", "light", "dark"];

const hashParts = () => {
  const h = window.location.hash.replace("#", "");
  const m = /^scenario-([a-z0-9-]{1,40})$/.exec(h);
  if (m) return { tab: "gate", scenario: m[1] };
  return { tab: TABS.some((t) => t.id === h) ? h : "gate", scenario: null };
};

export default function App() {
  const [vertical, setVertical] = useState("retail");
  const [story, setStory] = useState(null);
  const [info, setInfo] = useState(undefined); // undefined = loading, null = failed
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(hashParts().tab);
  const [requested, setRequested] = useState(hashParts().scenario);
  const [presenter, setPresenter] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const [resetMsg, setResetMsg] = useState("");
  const [theme, setTheme] = useState(() => { try { const t = window.localStorage.getItem("aplab.theme"); return THEMES.includes(t) ? t : "auto"; } catch { return "auto"; } });
  const [fontStep, setFontStep] = useState(() => { try { const f = window.localStorage.getItem("aplab.font"); return ["S", "M", "L"].includes(f) ? f : "M"; } catch { return "M"; } });

  useEffect(() => { getJson("/api/info").then(setInfo, () => setInfo(null)); }, []);
  useEffect(() => { getJson(`/api/scenarios?vertical=${encodeURIComponent(vertical)}`).then((j) => { setStory(j); setError(null); }, (e) => setError(e.message)); }, [vertical]);
  useEffect(() => {
    const on = () => { const p = hashParts(); setTab(p.tab); setRequested(p.scenario); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const select = (id) => { setTab(id); setRequested(null); try { window.history.replaceState(null, "", `#${id}`); } catch { /* ignore */ } };
  const pickScenario = (sid) => { try { window.history.replaceState(null, "", `#scenario-${sid}`); } catch { /* ignore */ } };

  useEffect(() => {
    const on = (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === "p" || e.key === "P") setPresenter((v) => !v);
      else if (e.key === "Escape") setPresenter(false);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "auto") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", theme);
    try { window.localStorage.setItem("aplab.theme", theme); } catch { /* storage blocked */ }
  }, [theme]);
  useEffect(() => {
    applyFontSize(fontStep);
    try { window.localStorage.setItem("aplab.font", fontStep); } catch { /* storage blocked */ }
  }, [fontStep]);

  const reset = useCallback(async () => {
    const ok = await resetWorkspace().catch(() => false);
    setResetSignal((n) => n + 1);
    setResetMsg(ok ? "Reset: your workspace's preferences, detection flag, challenges and runs are back to defaults." : "Reset failed on the server; the view was reset.");
  }, []);

  const hosted = story ? !!story.hosted : info ? !!info.hosted : null;
  const banner = story ? story.banner : hosted === true ? BANNER_HOSTED : hosted === false ? BANNER_LOCAL : BANNER_UNKNOWN;
  return (
    <div className={`app${presenter ? " app--presenter" : ""}`}>
      <header className="shell-bar">
        <span className="shell-brand">
          <span className="shell-logo" aria-hidden="true">AP</span>
          <h1>Agent Preferences Lab</h1>
          {info && info.mode === "real"
            ? <span className="shell-badge shell-badge--real" data-testid="mode-badge">Real</span>
            : <span className="shell-badge" data-testid="mode-badge">Mock</span>}
        </span>
        <nav className="shell-nav" aria-label="Lab sections">
          {TABS.map((t) => (
            <a key={t.id} href={`#${t.id}`} aria-current={tab === t.id ? "page" : undefined}
              onClick={(e) => { e.preventDefault(); select(t.id); }}>{t.label}</a>
          ))}
        </nav>
        <TopMenu
          mode={{ value: info?.mode === "real" ? "real" : "mock", onChange: async (target) => {
            if (info?.mode === target) return;
            const res = await setMode(target).catch(() => ({ ok: false, body: {} }));
            if (res.ok) { window.location.reload(); }
            else setResetMsg(res.body?.detail || "Could not switch mode.");
          }, realAvailable: info ? info.realAvailable : null, realHint: info?.realAvailable ? undefined : "Real is not configured: set REAL_PINGONE_ENV_ID, REAL_PINGONE_WORKER_ID and REAL_PINGONE_WORKER_SECRET (owner-run). Mock keeps working." }}
          vertical={{ value: vertical, onChange: setVertical, options: story ? story.verticals : ["retail"] }}
          theme={{ value: theme, onChange: setTheme }}
          fontSize={{ value: fontStep, onChange: setFontStep }}
          present={{ active: presenter, onToggle: () => setPresenter((v) => !v) }}
          talkTrack={{ active: tab === "talk", onToggle: () => select("talk") }}
          help={{ href: "https://github.com/curtismu7/agent-preferences-lab#readme" }}
          version={info?.version || null}
          onReset={reset}
        >
          <VerifyMark id="agent-preferences-lab" />
        </TopMenu>
      </header>
      <main className="page">
        <p className="banner" role="status" data-testid="banner">{banner}</p>
        {error && <p className="app-error" role="alert">Could not load the lab ({error}). Is the server running?</p>}
        <p className="sr-only" role="status" aria-live="polite">{resetMsg}</p>
        {!presenter && story && <p className="intro">{story.intro}</p>}
        <div id={`panel-${tab}`}>
          {error ? null : !story ? <p className="muted">Loading...</p> : (
            <>
              {presenter && tab !== "talk" && (
                <aside className="presenter-say" data-testid="presenter-say" aria-label="Talk track">
                  {story.talkTrack.filter((t) => (tab === "gate" ? ["say-first", "preferences", "boundary", "hitl", "protect", "unverified"] : ["say-first"]).includes(t.id)).map((t) => <p key={t.id}><strong>{t.title}.</strong> {t.say}</p>)}
                </aside>
              )}
              {tab === "gate" && <PreferencesGate key={vertical} story={story} resetSignal={resetSignal} requestedId={requested} onSelect={pickScenario} />}
              {tab === "diagram" && <DiagramTab vertical={vertical} resetSignal={resetSignal} />}
              {tab === "talk" && <TalkTrack talk={story.talkTrack} />}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
