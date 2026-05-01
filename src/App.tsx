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
import PretextConsole from "./components/PretextConsole";
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
import CodeSearchPanel from "./components/panes/CodeSearchPanel";
import SubagentTreePanel from "./components/panes/SubagentTreePanel";
import PerformancePanel from "./components/panes/PerformancePanel";
import ObsidianGraphPanel from "./components/panes/ObsidianGraphPanel";
import RunningProcessesPanel from "./components/panes/RunningProcessesPanel";
import SubscriptionLedgerPanel from "./components/panes/SubscriptionLedgerPanel";
import SessionReportPanel from "./components/panes/SessionReportPanel";
import PowerMetricsPanel from "./components/panes/PowerMetricsPanel";

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
};

const CELLS: Record<string, CellSpec> = {
  health: { area: "health", title: "HEALTH", accent: "rgba(208, 241, 0, 0.7)" },
  cadence: { area: "cadence", title: "CADENCE", accent: "rgba(208, 241, 0, 0.6)" },
  sparkline: { area: "sparkline", title: "EVENTS / 60min", accent: "rgba(140, 200, 255, 0.6)" },
  perf: { area: "perf", title: "PERFORMANCE", accent: "rgba(140, 200, 255, 0.6)" },
  mission: { area: "mission", title: "MISSION", accent: "rgba(208, 241, 0, 0.7)" },
  thinking: { area: "thinking", title: "THINKING", accent: "rgba(180, 160, 255, 0.7)" },
  live: { area: "live", title: "HERMES_LIVE", accent: "rgba(140, 200, 255, 0.7)" },
  memory: { area: "memory", title: "MEMORY", accent: "rgba(160, 240, 200, 0.7)" },
  proposals: { area: "proposals", title: "HERMES_PROPOSALS", accent: "rgba(255, 200, 120, 0.8)" },
  ledger: { area: "ledger", title: "TASK_LEDGER", accent: "rgba(208, 241, 0, 0.6)" },
  subscriptions: { area: "subscriptions", title: "SUBSCRIPTIONS", accent: "rgba(180, 160, 255, 0.6)" },
  report: { area: "report", title: "SESSION_REPORT", accent: "rgba(208, 241, 0, 0.7)" },
  power: { area: "power", title: "POWER_METRICS", accent: "rgba(208, 241, 0, 0.85)" },
  search: { area: "search", title: "CODE_SEARCH", accent: "rgba(140, 200, 255, 0.6)" },
  graph: { area: "graph", title: "OBSIDIAN_GRAPH", accent: "rgba(160, 240, 200, 0.6)" },
  subagents: { area: "subagents", title: "SUBAGENT_TREE", accent: "rgba(180, 160, 255, 0.6)" },
  themed: { area: "themed", title: "THEMED_SURFACES", accent: "rgba(208, 241, 0, 0.5)" },
  sessions: { area: "sessions", title: "TELEGRAM_SESSIONS", accent: "rgba(160, 240, 200, 0.6)" },
  skills: { area: "skills", title: "SKILLS", accent: "rgba(180, 160, 255, 0.6)" },
  memfiles: { area: "memfiles", title: "MEMORY_FILES", accent: "rgba(160, 240, 200, 0.6)" },
  runlog: { area: "runlog", title: "RUN_LOG", accent: "rgba(224, 246, 255, 0.4)" },
  local: { area: "local", title: "LOCAL_CONSOLE", accent: "rgba(224, 246, 255, 0.4)" },
  changelog: { area: "changelog", title: "CHANGELOG", accent: "rgba(208, 241, 0, 0.4)" },
  git: { area: "git", title: "GIT_STATE", accent: "rgba(208, 241, 0, 0.5)" },
  publish: { area: "publish", title: "GITHUB_PUBLISH", accent: "rgba(208, 241, 0, 0.7)" },
  improve: { area: "improve", title: "IMPROVEMENT_LOOP", accent: "rgba(180, 160, 255, 0.6)" }
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

  useEffect(() => {
    const off = subscribeHermesStream({
      onEvent: (event) => setLiveEvents((prev) => [event, ...prev].slice(0, 80)),
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
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === "/") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('[data-pane-input="code-search"]')?.focus();
      } else if (e.key === "Escape") {
        setInspectedEvent(null);
        setDiffProposal(null);
      } else if (e.key === "g") {
        setActiveNode("hermes");
      } else if (e.key === "p") {
        const proposal = payload?.pendingProposals?.[0];
        if (proposal) setDiffProposal(proposal);
      } else if (e.key === "m") {
        const latestEvent = liveEvents[0];
        if (latestEvent) setInspectedEvent(latestEvent);
      } else if (e.key === "?") {
        alert("g: focus hermes · p: preview top proposal · m: inspect latest event · /: code-search · Esc: close overlays");
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
    return (
      <section className="bento-cell" style={{ gridArea: spec.area }}>
        <header className="bento-header">
          <span className="bento-title">{spec.title}</span>
        </header>
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
        <span className="topbar-mode muted">
          {payload.cadence.mode.toUpperCase()} · idle {payload.cadence.idleSec}s · {Math.round(payload.cadence.recommendedIntervalMs / 1000)}s · {payload.cadence.recommendedAutoApply ? "AUTO-APPLY" : "manual"}
        </span>
        <span className="kbd-hint muted">/ search · g focus · p propose · m inspect · ? help</span>
      </header>

      <aside className="bento-rail">
        <RunningProcessesPanel processes={payload.processes} />
      </aside>

      <div className="bento-grid">
        {cell("health", <HealthPanel payload={payload} />)}
        {cell("cadence", <CadencePanel cadence={payload.cadence} />)}
        {cell("sparkline", <SparklinePanel buckets={payload.timeline?.buckets || []} total={payload.timeline?.total || 0} peak={payload.timeline?.peak || 0} />)}
        {cell("perf", <PerformancePanel payload={payload} />)}

        {cell("mission", <MissionPanel mission={payload.mission} />)}
        {cell("thinking", <ThinkingPanel mission={payload.mission} />)}
        {cell("live", <HermesLivePanel events={liveEvents} onSelect={setInspectedEvent} />)}
        {cell("memory", <MemoryPanel mission={payload.mission} events={liveEvents} />)}

        {cell("proposals",
          payload.pendingProposals.length === 0 ? (
            <div className="muted">no pending proposals · validator running</div>
          ) : (
            <div className="proposal-stack">
              {payload.pendingProposals.slice(0, 4).map((proposal) => (
                <article className="proposal-card" key={proposal.id}>
                  <header>
                    <strong>◆ {proposal.title}</strong>
                    <span className="proposal-kind">({proposal.kind})</span>
                  </header>
                  <p className="proposal-rationale">{proposal.rationale}</p>
                  {proposal.command ? <code className="proposal-cmd">{proposal.command}</code> : null}
                  {proposal.argv?.length ? <code className="proposal-cmd">{proposal.argv.join(" ")}</code> : null}
                  <div className="proposal-actions">
                    <button className="button button-mini button-primary" disabled={busy === `prop:${proposal.id}`} onClick={() => handleProposalDecision(proposal, "confirm")}>apply</button>
                    <button className="button button-mini button-light" disabled={busy === `prop:${proposal.id}`} onClick={() => handleProposalDecision(proposal, "decline")}>decline</button>
                    <button className="button button-mini button-light" onClick={() => setDiffProposal(proposal)}>diff</button>
                  </div>
                </article>
              ))}
            </div>
          )
        )}

        {cell("ledger",
          <ul className="row-list">
            {payload.tasks.length === 0 && <li className="muted">no tasks · ledger empty</li>}
            {payload.tasks.slice(0, 12).map((t) => (
              <li key={t.id} className="row" title={t.notes?.[t.notes.length - 1] || ""}>
                <span className={`row-tag ${t.status === "done" ? "ok" : t.status === "blocked" ? "warn" : "muted"}`}>{t.status}</span>
                <span className="row-id">[{t.mission}]</span>
                <span className="row-content truncate">{t.title}</span>
              </li>
            ))}
          </ul>
        )}

        {cell("report", <SessionReportPanel />)}
        {cell("power", <PowerMetricsPanel />)}
        {cell("subscriptions", <SubscriptionLedgerPanel tasks={payload.subscriptions} />)}
        {cell("search", <CodeSearchPanel />)}
        {cell("graph", <ObsidianGraphPanel />)}
        {cell("subagents", <SubagentTreePanel payload={payload} />)}
        {cell("themed", <ThemedSurfacesPanel themed={payload.themed} />)}

        {cell("sessions", <SessionsPanel sessions={payload.sessions?.sessions || []} />)}
        {cell("skills", <SkillsPanel skills={payload.skills?.skills || []} activeCount={payload.skills?.activeCount || 0} disabledCount={payload.skills?.disabledCount || 0} totalCount={payload.skills?.totalCount || 0} />)}
        {cell("memfiles", <MemoryFilesPanel files={payload.memoryFiles?.files || []} count={payload.memoryFiles?.count || 0} />)}

        {cell("runlog", <RunLogPanel runs={payload.runRequests} />)}
        {cell("local", <LocalConsolePanel messages={payload.localMessages} />)}
        {cell("changelog", <ChangelogPanel entries={payload.changelog} />)}

        {cell("git", <GitStatePanel git={payload.git} />)}
        {cell("publish", <GithubPublishPanel publishStatus={payload.publishStatus} />)}
        {cell("improve", <ImprovementLoopPanel payload={payload} />)}
      </div>

      <div className="bento-canvas-stage">
        <PretextConsole payload={payload} nodes={nodes} activeNode={activeNode} liveEvents={liveEvents} />
        <div className="node-layer" aria-label="Hermes console nodes">
          {nodes.map((node) => (
            <button
              key={node.id}
              className={`node-hotspot ${node.id === activeNode ? "node-hotspot-active" : ""}`}
              style={{ left: `${node.x}%`, top: `${node.y}%` }}
              onClick={() => setActiveNode(node.id)}
              aria-label={`Focus ${node.label}`}
              aria-pressed={node.id === activeNode}
            />
          ))}
        </div>
      </div>

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
    </main>
  );
}
