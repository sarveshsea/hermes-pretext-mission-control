import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  approveRunRequest,
  createLocalMessage,
  createRunRequest,
  decideProposal,
  decidePublicIntent,
  fetchDashboard,
  rejectRunRequest,
  setHermesModel,
  subscribeHermesStream,
  type DashboardPayload,
  type HermesEvent,
  type Proposal,
  type PublicIntent,
  type RunRequest
} from "./api";
import { buildConsoleNodes, type ConsoleNodeId } from "./consoleModel";
import HermesStatusCard from "./components/HermesStatusCard";
import PipelineRiver from "./components/PipelineRiver";
import LiveTimeline from "./components/LiveTimeline";
import PretextDock from "./components/PretextDock";
import InspectorOverlay from "./components/InspectorOverlay";
import DiffPreviewOverlay from "./components/DiffPreviewOverlay";
import HealthPanel from "./components/panes/HealthPanel";
import CadencePanel from "./components/panes/CadencePanel";
import SparklinePanel from "./components/panes/SparklinePanel";
import GitStatePanel from "./components/panes/GitStatePanel";
import GithubPublishPanel from "./components/panes/GithubPublishPanel";
import ImprovementLoopPanel from "./components/panes/ImprovementLoopPanel";
import SessionsPanel from "./components/panes/SessionsPanel";
import SkillsPanel from "./components/panes/SkillsPanel";
import MemoryFilesPanel from "./components/panes/MemoryFilesPanel";
import HermesLivePanel from "./components/panes/HermesLivePanel";
import ThinkingPanel from "./components/panes/ThinkingPanel";
import MissionPanel from "./components/panes/MissionPanel";
import MemoryPanel from "./components/panes/MemoryPanel";
import RunLogPanel from "./components/panes/RunLogPanel";
import LocalConsolePanel from "./components/panes/LocalConsolePanel";
import ChangelogPanel from "./components/panes/ChangelogPanel";
import ThemedSurfacesPanel from "./components/panes/ThemedSurfacesPanel";
import SubagentTreePanel from "./components/panes/SubagentTreePanel";
import PerformancePanel from "./components/panes/PerformancePanel";
import RunningProcessesPanel from "./components/panes/RunningProcessesPanel";
import SubscriptionLedgerPanel from "./components/panes/SubscriptionLedgerPanel";
import SessionReportPanel from "./components/panes/SessionReportPanel";
import PowerMetricsPanel from "./components/panes/PowerMetricsPanel";
import PlaybookScoreboardPanel from "./components/panes/PlaybookScoreboardPanel";
import GoalsPanel from "./components/panes/GoalsPanel";
import OllamaQueuePanel from "./components/panes/OllamaQueuePanel";
import ArchivesPanel from "./components/panes/ArchivesPanel";
import DraftPoolPanel from "./components/panes/DraftPoolPanel";
import ImprovementsLogPanel from "./components/panes/ImprovementsLogPanel";
import SystemPulsePanel from "./components/panes/SystemPulsePanel";
import LastShippedChip from "./components/LastShippedChip";
import DelegationInboxPanel from "./components/panes/DelegationInboxPanel";
import AgentVoicePanel from "./components/panes/AgentVoicePanel";
import WhyStrip from "./components/WhyStrip";
import CommandPalette from "./components/CommandPalette";

const POLL_MS = 12_000;
const DEFAULT_NODE: ConsoleNodeId = "hermes";
const SUGGESTED_COMMANDS = [
  "npm run check",
  "npm run build",
  "npm test",
  "npm run typecheck",
  "npm run dev",
  "git status",
  "ls /tmp"
];

type CellSpec = {
  area: string;
  title: string;
  accent?: string;
  tier?: 1 | 2 | 3;
  summaryKey?: string;
};

const CELLS: Record<string, CellSpec> = {
  pulse: { area: "pulse", title: "SYSTEM PULSE", accent: "rgba(63, 205, 255, 0.7)", tier: 1 },
  mission: { area: "mission", title: "MISSION", accent: "rgba(208, 241, 0, 0.7)", tier: 2 },
  thinking: { area: "thinking", title: "THINKING", accent: "rgba(180, 160, 255, 0.7)", tier: 1, summaryKey: "thinking" },
  live: { area: "live", title: "HERMES_LIVE", accent: "rgba(140, 200, 255, 0.7)", tier: 1, summaryKey: "live" },
  memory: { area: "memory", title: "MEMORY", accent: "rgba(160, 240, 200, 0.7)", tier: 2 },
  proposals: { area: "proposals", title: "HERMES_PROPOSALS", accent: "rgba(255, 200, 120, 0.8)", tier: 1, summaryKey: "proposals" },
  ledger: { area: "ledger", title: "TASK_LEDGER", accent: "rgba(208, 241, 0, 0.6)", tier: 1, summaryKey: "ledger" },
  subscriptions: { area: "subscriptions", title: "SUBSCRIPTIONS", accent: "rgba(180, 160, 255, 0.6)", tier: 3 },
  report: { area: "report", title: "SESSION_REPORT", accent: "rgba(208, 241, 0, 0.7)", tier: 2 },
  power: { area: "power", title: "POWER_METRICS", accent: "rgba(208, 241, 0, 0.85)", tier: 1, summaryKey: "power" },
  scoreboard: { area: "scoreboard", title: "PLAYBOOK_SCOREBOARD", accent: "rgba(208, 241, 0, 0.7)", tier: 1 },
  goals: { area: "goals", title: "GOALS", accent: "rgba(180, 160, 255, 0.7)", tier: 1 },
  ollama: { area: "ollama", title: "OLLAMA_QUEUE", accent: "rgba(140, 200, 255, 0.7)", tier: 2 },
  archives: { area: "archives", title: "ARCHIVES", accent: "rgba(255, 255, 255, 0.18)", tier: 3 },
  drafts: { area: "drafts", title: "DRAFT_POOL", accent: "rgba(255, 200, 90, 0.6)", tier: 2 },
  improvements: { area: "improvements", title: "CONTINUOUS_IMPROVEMENTS", accent: "rgba(63, 205, 255, 0.7)", tier: 1 },
  delegation: { area: "delegation", title: "DELEGATION_INBOX", accent: "rgba(180, 160, 255, 0.7)", tier: 1 },
  agentvoice: { area: "agentvoice", title: "AGENT_VOICE", accent: "rgba(140, 200, 255, 0.6)", tier: 2 },
  subagents: { area: "subagents", title: "SUBAGENT_TREE", accent: "rgba(180, 160, 255, 0.6)", tier: 2, summaryKey: "swarm" },
  themed: { area: "themed", title: "THEMED_SURFACES", accent: "rgba(208, 241, 0, 0.5)", tier: 2 },
  sessions: { area: "sessions", title: "TELEGRAM_SESSIONS", accent: "rgba(160, 240, 200, 0.6)", tier: 3 },
  skills: { area: "skills", title: "SKILLS", accent: "rgba(180, 160, 255, 0.6)", tier: 3 },
  memfiles: { area: "memfiles", title: "MEMORY_FILES", accent: "rgba(160, 240, 200, 0.6)", tier: 3 },
  runlog: { area: "runlog", title: "RUN_LOG", accent: "rgba(224, 246, 255, 0.4)", tier: 3 },
  local: { area: "local", title: "LOCAL_CONSOLE", accent: "rgba(224, 246, 255, 0.4)", tier: 3 },
  changelog: { area: "changelog", title: "CHANGELOG", accent: "rgba(208, 241, 0, 0.4)", tier: 3 },
  git: { area: "git", title: "GIT_STATE", accent: "rgba(208, 241, 0, 0.5)", tier: 3 },
  publish: { area: "publish", title: "GITHUB_PUBLISH", accent: "rgba(208, 241, 0, 0.7)", tier: 3 },
  improve: { area: "improve", title: "IMPROVEMENT_LOOP", accent: "rgba(180, 160, 255, 0.6)", tier: 3 }
};

function isActionable(request: RunRequest) {
  return request.status === "pending";
}

function WorkingIndicator({ payload, eventCount, latestEvent }: { payload: DashboardPayload; eventCount: number; latestEvent?: HermesEvent }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const lastEventMs = latestEvent ? new Date(latestEvent.createdAt).getTime() : 0;
  const ageSec = lastEventMs ? Math.max(0, Math.round((now - lastEventMs) / 1000)) : null;
  const cron = (payload.processes?.crons || []).find((c) => c.id === "pretext-auto-improve");
  const nextMs = cron?.nextRunAt ? new Date(cron.nextRunAt).getTime() - now : 0;
  const nextSec = Math.max(0, Math.round(nextMs / 1000));
  const tone = ageSec == null ? "muted" : ageSec < 30 ? "ok" : ageSec < 300 ? "warn" : "alert";
  return (
    <span className={`working-indicator ${tone}`}>
      <span className="pulse-dot" aria-hidden>●</span>
      <span>last event {ageSec == null ? "—" : `${ageSec}s ago`}</span>
      <span className="muted">·</span>
      <span>events {eventCount}</span>
      {cron ? (
        <>
          <span className="muted">·</span>
          <span>cron in {Math.floor(nextSec / 60)}m{nextSec % 60}s</span>
        </>
      ) : null}
    </span>
  );
}

export default function App() {
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [activeNode, setActiveNode] = useState<ConsoleNodeId>(DEFAULT_NODE);
  const [command, setCommand] = useState(SUGGESTED_COMMANDS[0]);
  const [reason, setReason] = useState("local console improvement check");
  const [localMessage, setLocalMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [liveEvents, setLiveEvents] = useState<HermesEvent[]>([]);
  const [liveIntents, setLiveIntents] = useState<PublicIntent[]>([]);
  const [inspectedEvent, setInspectedEvent] = useState<HermesEvent | null>(null);
  const [diffProposal, setDiffProposal] = useState<Proposal | null>(null);
  const [paneSummaries, setPaneSummaries] = useState<Record<string, string>>({});
  const [paneDots, setPaneDots] = useState<Record<string, "green" | "amber" | "red">>({});
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [focusMode, setFocusMode] = useState<boolean>(() => document.documentElement.getAttribute("data-focus") === "on");
  const [priorityPrompt, setPriorityPrompt] = useState("");

  const refresh = useCallback(async () => {
    try {
      const next = await fetchDashboard();
      setPayload(next);
      setLiveEvents(next.hermesEvents.slice(0, 80));
      setLiveIntents(next.pendingPublicIntents);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dashboard refresh failed");
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  // Persist + restore theme on mount.
  useEffect(() => {
    const saved = localStorage.getItem("pretext-theme");
    if (saved === "light" || saved === "dark") {
      document.documentElement.setAttribute("data-theme", saved);
    }
  }, []);

  // Pane summaries + health dots — refreshed independently from the main payload.
  useEffect(() => {
    let cancelled = false;
    const fetchSummaries = async () => {
      try {
        const res = await fetch("/api/hermes/pane-summaries", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setPaneSummaries(data.summaries || {});
          setPaneDots(data.dots || {});
        }
      } catch {
        // best-effort
      }
    };
    void fetchSummaries();
    const id = window.setInterval(fetchSummaries, 8_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const glowArea = (area: string) => {
      const el = document.querySelector(`.bento-cell[style*="grid-area: ${area}"]`)
        || document.querySelector(`.bento-cell[style*="${area}"]`);
      if (!el) return;
      el.setAttribute("data-glow", "on");
      window.setTimeout(() => el.removeAttribute("data-glow"), 720);
    };
    const eventToArea = (type: string): string => {
      if (!type) return "live";
      if (type.startsWith("proposal_") || type === "proposal") return "proposals";
      if (type.startsWith("task_") || type === "pickTask" || type === "concretize" || type === "playbook") return "ledger";
      if (type.startsWith("subscription_") || type === "claude_dispatch") return "subscriptions";
      if (type === "improvement" || type === "improvement_log" || type === "commit") return "improvements";
      if (type === "delegation" || type.startsWith("delegation_")) return "delegation";
      if (type === "draft" || type.startsWith("draft_")) return "drafts";
      if (type === "thinking" || type === "memory") return "thinking";
      return "live";
    };
    const off = subscribeHermesStream({
      onEvent: (event) => {
        setLiveEvents((prev) => [event, ...prev].slice(0, 80));
        glowArea(eventToArea(event.type));
      },
      onPublicIntent: (intent) => {
        setLiveIntents((prev) =>
          intent.status === "pending"
            ? [intent, ...prev.filter((item) => item.id !== intent.id)]
            : prev.filter((item) => item.id !== intent.id)
        );
      }
    });
    return off;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Cmd/Ctrl+K opens the palette regardless of focus context
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === "Escape") {
        setInspectedEvent(null);
        setDiffProposal(null);
        setPaletteOpen(false);
      } else if (e.key === "g") {
        setActiveNode("hermes");
      } else if (e.key === "p") {
        const proposal = payload?.pendingProposals?.[0];
        if (proposal) setDiffProposal(proposal);
      } else if (e.key === "m") {
        const latestEvent = liveEvents[0];
        if (latestEvent) setInspectedEvent(latestEvent);
      } else if (e.key === "f" || e.key === "F") {
        setFocusMode((cur) => {
          const next = !cur;
          document.documentElement.setAttribute("data-focus", next ? "on" : "off");
          return next;
        });
      } else if (e.key === "?") {
        alert("⌘K: command palette · g: focus hermes · p: preview top proposal · m: inspect latest event · F: focus mode · Esc: close overlays");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [liveEvents, payload]);

  const nodes = useMemo(() => (payload ? buildConsoleNodes(payload) : []), [payload]);
  const actionableRequests = useMemo(
    () => payload?.runRequests.filter(isActionable).slice(0, 4) ?? [],
    [payload]
  );

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("create");
    try {
      await createRunRequest(command, reason);
      setReason("local console improvement check");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create request failed");
    } finally {
      setBusy("");
    }
  }
  async function handleApprove(id: string) {
    setBusy(`approve:${id}`);
    try { await approveRunRequest(id); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "Approval failed"); }
    finally { setBusy(""); }
  }
  async function handleReject(id: string) {
    setBusy(`reject:${id}`);
    try { await rejectRunRequest(id, "Rejected in Pretext Console"); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "Reject failed"); }
    finally { setBusy(""); }
  }
  async function handleLocalMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("message");
    try { await createLocalMessage(localMessage); setLocalMessage(""); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "Local message failed"); }
    finally { setBusy(""); }
  }
  async function handleModelChange(event: React.ChangeEvent<HTMLSelectElement>) {
    setBusy("model");
    try { await setHermesModel(event.target.value); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "Model switch failed"); }
    finally { setBusy(""); }
  }
  async function handleIntentDecision(intent: PublicIntent, decision: "confirm" | "decline") {
    setBusy(`intent:${intent.id}`);
    try {
      await decidePublicIntent(intent.id, decision, decision === "decline" ? { reason: "declined locally" } : {});
      setLiveIntents((prev) => prev.filter((item) => item.id !== intent.id));
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Intent decision failed"); }
    finally { setBusy(""); }
  }
  async function handleProposalDecision(proposal: Proposal, decision: "confirm" | "decline") {
    setBusy(`prop:${proposal.id}`);
    try { await decideProposal(proposal.id, decision, decision === "decline" ? { reason: "declined locally" } : {}); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "Proposal decision failed"); }
    finally { setBusy(""); }
  }

  if (!payload) {
    return (
      <main className="bento-stage loading-stage">
        <div className="loading-card">
          <span>PRETEXT_BOOT</span>
          <strong>reading local agent memory</strong>
        </div>
      </main>
    );
  }

  const runtime = payload.hermesRuntime;
  const knownModels = runtime?.knownModels?.length ? runtime.knownModels : [runtime?.model || "gemma4:e4b"];

  function cell(key: keyof typeof CELLS, body: React.ReactNode) {
    const spec = CELLS[key];
    const summary = spec.summaryKey ? paneSummaries[spec.summaryKey] : null;
    const dot = paneDots[String(key)] || paneDots[spec.summaryKey || ""] || null;
    return (
      <section className="bento-cell" data-tier={spec.tier || 2} style={{ gridArea: spec.area }}>
        <header className="bento-header">
          <span className="bento-title">{spec.title}</span>
          {dot ? <span className={`pane-dot pane-dot-${dot}`} aria-hidden>●</span> : null}
        </header>
        {summary ? <div className="bento-summary">{summary}</div> : null}
        <div className="bento-body">{body}</div>
      </section>
    );
  }

  return (
    <main className="bento-stage">
      <header className="bento-topbar">
        <div className="brand-mark">H</div>
        <select className="model-select" value={runtime?.model || ""} onChange={handleModelChange} disabled={busy === "model"} aria-label="Active Hermes model">
          {knownModels.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button className="button button-ghost" onClick={refresh}>refresh</button>
        <WorkingIndicator payload={payload} eventCount={liveEvents.length} latestEvent={liveEvents[0]} />
        <LastShippedChip />
        <span className="topbar-mode muted">
          {payload.cadence.mode.toUpperCase()} · idle {payload.cadence.idleSec}s · {Math.round(payload.cadence.recommendedIntervalMs / 1000)}s · {payload.cadence.recommendedAutoApply ? "AUTO-APPLY" : "manual"}
        </span>
        <button
          className="button button-ghost theme-toggle"
          onClick={() => {
            const cur = document.documentElement.getAttribute("data-theme");
            const next = cur === "light" ? "dark" : "light";
            document.documentElement.setAttribute("data-theme", next);
            localStorage.setItem("pretext-theme", next);
          }}
          title="toggle dark/light theme"
          aria-label="toggle theme"
        >🌗</button>
        <button
          className={`button button-ghost focus-toggle ${focusMode ? "is-on" : ""}`}
          onClick={() => {
            setFocusMode((cur) => {
              const next = !cur;
              document.documentElement.setAttribute("data-focus", next ? "on" : "off");
              return next;
            });
          }}
          title="focus mode (F) — hide tier-3 panes"
          aria-pressed={focusMode}
        >{focusMode ? "◉ focus" : "○ focus"}</button>
        <button
          className="button button-ghost cmdk-trigger"
          onClick={() => setPaletteOpen(true)}
          title="open command palette (⌘K)"
        >⌘K</button>
        <span className="kbd-hint muted">⌘K palette · g focus · p propose · m inspect · F focus mode · ? help</span>
      </header>

      <aside className="bento-rail">
        <RunningProcessesPanel processes={payload.processes} />
      </aside>

      <div className="bento-grid">
        <div className="bento-why-row" style={{ gridArea: "why" }}>
          <WhyStrip />
        </div>
        {cell("pulse", <SystemPulsePanel payload={payload} eventCount={liveEvents.length} />)}

        {cell("mission", <MissionPanel mission={payload.mission} />)}
        {cell("thinking", <ThinkingPanel mission={payload.mission} />)}
        {cell("live", <HermesLivePanel events={liveEvents} onSelect={setInspectedEvent} />)}
        {cell("memory", <MemoryPanel mission={payload.mission} events={liveEvents} />)}
        {cell("agentvoice", <AgentVoicePanel events={liveEvents} onSelect={setInspectedEvent} />)}
        {cell("delegation", <DelegationInboxPanel />)}

        {cell("proposals",
          payload.pendingProposals.length === 0 ? (
            <div className="muted">no pending proposals · validator running</div>
          ) : (
            <div className="proposal-stack">
              {payload.pendingProposals.slice(0, 4).map((proposal) => {
                const p = proposal as unknown as { kind: string; filePath?: string; find?: string; replace?: string };
                const showInlineDiff = p.kind === "edit" && p.filePath && p.find && typeof p.replace === "string";
                return (
                  <article className="proposal-card" key={proposal.id}>
                    <header>
                      <strong>◆ {proposal.title}</strong>
                      <span className="proposal-kind">({proposal.kind})</span>
                    </header>
                    <p className="proposal-rationale">{proposal.rationale}</p>
                    {proposal.command ? <code className="proposal-cmd">{proposal.command}</code> : null}
                    {proposal.argv?.length ? <code className="proposal-cmd">{proposal.argv.join(" ")}</code> : null}
                    {showInlineDiff ? (
                      <div className="proposal-inline-diff">
                        <div className="proposal-diff-file muted">{p.filePath}</div>
                        <div className="proposal-diff-line proposal-diff-find">- {p.find?.slice(0, 140)}</div>
                        <div className="proposal-diff-line proposal-diff-replace">+ {p.replace?.slice(0, 140)}</div>
                      </div>
                    ) : null}
                    <div className="proposal-actions">
                      <button className="button button-mini button-primary" disabled={busy === `prop:${proposal.id}`} onClick={() => handleProposalDecision(proposal, "confirm")}>apply</button>
                      <button className="button button-mini button-light" disabled={busy === `prop:${proposal.id}`} onClick={() => handleProposalDecision(proposal, "decline")}>decline</button>
                      <button className="button button-mini button-light" onClick={() => setDiffProposal(proposal)}>diff</button>
                    </div>
                  </article>
                );
              })}
            </div>
          )
        )}

        {cell("ledger",
          <ul className="row-list">
            {payload.tasks.length === 0 && <li className="muted">no tasks · ledger empty</li>}
            {payload.tasks.slice(0, 12).map((t) => {
              const ps = (t as unknown as { pipelineState?: { attempts?: number; updatedAt?: string; lastError?: string } }).pipelineState;
              const attempts = ps?.attempts || 0;
              const stuck = attempts >= 2;
              const stuckSince = stuck && ps?.updatedAt
                ? Math.round((Date.now() - new Date(ps.updatedAt).getTime()) / 60_000)
                : null;
              return (
                <li
                  key={t.id}
                  className="row"
                  data-stuck={stuck ? "true" : undefined}
                  title={ps?.lastError || t.notes?.[t.notes.length - 1] || ""}
                >
                  <span className={`row-tag ${t.status === "done" ? "ok" : t.status === "blocked" ? "warn" : "muted"}`}>{t.status}</span>
                  <span className="row-id">[{t.mission}]</span>
                  <span className="row-content truncate">{t.title}</span>
                  {stuck ? <span className="row-stuck" title={ps?.lastError || ""}>stuck {stuckSince}m · {attempts}×</span> : null}
                </li>
              );
            })}
          </ul>
        )}

        {cell("report", <SessionReportPanel />)}
        {cell("power", <PowerMetricsPanel />)}
        {cell("scoreboard", <PlaybookScoreboardPanel />)}
        {cell("goals", <GoalsPanel />)}
        {cell("ollama", <OllamaQueuePanel />)}
        {cell("subscriptions", <SubscriptionLedgerPanel tasks={payload.subscriptions} />)}
        {cell("drafts", <DraftPoolPanel />)}
        {cell("improvements", <ImprovementsLogPanel />)}
        {cell("subagents", <SubagentTreePanel payload={payload} />)}
        {cell("themed", <ThemedSurfacesPanel themed={payload.themed} />)}

        {cell("archives",
          <ArchivesPanel
            defaultId="runlog"
            tabs={[
              { id: "runlog", label: "RUN_LOG", count: payload.runRequests?.length, body: <RunLogPanel runs={payload.runRequests} /> },
              { id: "local", label: "LOCAL", count: payload.localMessages?.length, body: <LocalConsolePanel messages={payload.localMessages} /> },
              { id: "git", label: "GIT", body: <GitStatePanel git={payload.git} /> },
              { id: "publish", label: "PUBLISH", body: <GithubPublishPanel publishStatus={payload.publishStatus} /> },
              { id: "improve", label: "IMPROVE", body: <ImprovementLoopPanel payload={payload} /> },
              { id: "changelog", label: "CHANGELOG", count: payload.changelog?.length, body: <ChangelogPanel entries={payload.changelog} /> },
              { id: "sessions", label: "SESSIONS", count: payload.sessions?.sessions?.length, body: <SessionsPanel sessions={payload.sessions?.sessions || []} /> },
              { id: "skills", label: "SKILLS", count: payload.skills?.activeCount, body: <SkillsPanel skills={payload.skills?.skills || []} activeCount={payload.skills?.activeCount || 0} disabledCount={payload.skills?.disabledCount || 0} totalCount={payload.skills?.totalCount || 0} /> },
              { id: "memfiles", label: "MEMORY_FILES", count: payload.memoryFiles?.count, body: <MemoryFilesPanel files={payload.memoryFiles?.files || []} count={payload.memoryFiles?.count || 0} /> }
            ]}
          />
        )}
      </div>

      <aside className="ops-stage" aria-label="Hermes operator surface">
        <HermesStatusCard payload={payload} eventCount={liveEvents.length} />
        <PipelineRiver />
        <LiveTimeline events={liveEvents} onSelect={setInspectedEvent} />
      </aside>

      {liveIntents.length > 0 && (
        <aside className="intent-dock" aria-label="Pending public actions">
          {liveIntents.map((intent) => (
            <article className="intent-row" key={intent.id}>
              <header>
                <strong>{intent.action}</strong>
                <span> → {intent.surface} ({intent.audience})</span>
              </header>
              <p className="intent-content">{intent.content}</p>
              <p className="intent-meta">worst-case: {intent.worstCase} · legal: {intent.legalPosture} · rep: {intent.reputationPosture}</p>
              <div className="intent-actions">
                <button className="button button-mini button-primary" disabled={busy === `intent:${intent.id}`} onClick={() => handleIntentDecision(intent, "confirm")}>confirm</button>
                <button className="button button-mini button-light" disabled={busy === `intent:${intent.id}`} onClick={() => handleIntentDecision(intent, "decline")}>decline</button>
              </div>
            </article>
          ))}
        </aside>
      )}

      {(actionableRequests.length || error) && (
        <aside className="run-dock" aria-label="Actionable run requests">
          {error ? <div className="error-banner">{error}</div> : null}
          {actionableRequests.map((request) => (
            <article className="request-row" key={request.id}>
              <code>{request.command || "empty"}</code>
              <em className="request-status request-status-ready">{request.status}</em>
              <button className="button button-mini button-primary" disabled={request.status !== "pending" || busy === `approve:${request.id}`} onClick={() => handleApprove(request.id)}>run</button>
              <button className="button button-mini button-light" disabled={busy === `reject:${request.id}`} onClick={() => handleReject(request.id)}>reject</button>
            </article>
          ))}
        </aside>
      )}

      <form
        className="priority-dock"
        aria-label="Send a high-priority task to Hermes"
        onSubmit={async (e) => {
          e.preventDefault();
          const title = priorityPrompt.trim();
          if (!title) return;
          setBusy("priority");
          try {
            await fetch("/api/hermes/tasks", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title,
                mission: "general",
                createdBy: "operator",
                tags: ["manual-priority"],
                notes: ["queued from dashboard priority input"]
              })
            });
            setPriorityPrompt("");
            await refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : "priority task failed");
          } finally {
            setBusy("");
          }
        }}
      >
        <span className="priority-label muted">PRIORITY ▸</span>
        <input
          className="priority-input"
          aria-label="Priority task title"
          value={priorityPrompt}
          onChange={(e) => setPriorityPrompt(e.target.value)}
          placeholder="tell hermes what to ship next…"
        />
        <button className="native-submit-button" disabled={busy === "priority" || !priorityPrompt.trim()}>queue priority</button>
      </form>

      <form className="message-dock" onSubmit={handleLocalMessage} aria-label="Send local message to Hermes">
        <PretextDock mode="message" value={localMessage} busy={busy === "message"} />
        <input className="native-message-input" aria-label="Local message" value={localMessage} onChange={(e) => setLocalMessage(e.target.value)} placeholder="message hermes locally..." />
        <button className="native-submit-button" disabled={busy === "message" || !localMessage.trim()}>send</button>
      </form>

      <form className="command-dock" onSubmit={handleCreate} aria-label="Create local run request">
        <PretextDock mode="command" value={command} detail={reason} busy={busy === "create"} />
        <input className="command-input" aria-label="Command" value={command} list="suggested-commands" onChange={(e) => setCommand(e.target.value)} placeholder="any shell command..." />
        <datalist id="suggested-commands">{SUGGESTED_COMMANDS.map((item) => <option key={item} value={item} />)}</datalist>
        <input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="native-submit-button" disabled={busy === "create"}>queue</button>
      </form>

      <InspectorOverlay event={inspectedEvent} onClose={() => setInspectedEvent(null)} />
      <DiffPreviewOverlay proposal={diffProposal} onClose={() => setDiffProposal(null)} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </main>
  );
}
