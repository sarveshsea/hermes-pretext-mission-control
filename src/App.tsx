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
import DraggablePane from "./components/DraggablePane";
import DraggableLayer from "./components/DraggableLayer";
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
import { resetServerLayout, type PanePosition } from "./layout";

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

const PANE_IDS = [
  "health",
  "cadence",
  "sparkline",
  "git-state",
  "github-publish",
  "improvement-loop",
  "performance",
  "sessions",
  "skills",
  "memory-files",
  "hermes-live",
  "thinking",
  "mission",
  "memory",
  "run-log",
  "local-console",
  "changelog",
  "code-search",
  "subagent-tree",
  "themed-surfaces",
  "obsidian-graph"
];

const PANE_TITLES: Record<string, string> = {
  health: "HEALTH",
  cadence: "CADENCE",
  sparkline: "EVENTS/MIN",
  "git-state": "GIT_STATE",
  "github-publish": "GITHUB_PUBLISH",
  "improvement-loop": "IMPROVEMENT_LOOP",
  performance: "PERFORMANCE",
  sessions: "TELEGRAM_SESSIONS",
  skills: "SKILLS",
  "memory-files": "MEMORY_FILES",
  "hermes-live": "HERMES_LIVE",
  thinking: "THINKING",
  mission: "MISSION",
  memory: "MEMORY",
  "run-log": "RUN_LOG",
  "local-console": "LOCAL_CONSOLE",
  changelog: "CHANGELOG",
  "code-search": "CODE_SEARCH",
  "subagent-tree": "SUBAGENT_TREE",
  "themed-surfaces": "THEMED_SURFACES",
  "obsidian-graph": "OBSIDIAN_GRAPH"
};

const PANE_ACCENTS: Record<string, string> = {
  health: "rgba(208, 241, 0, 0.7)",
  cadence: "rgba(208, 241, 0, 0.7)",
  sparkline: "rgba(140, 200, 255, 0.6)",
  "git-state": "rgba(208, 241, 0, 0.5)",
  "github-publish": "rgba(208, 241, 0, 0.7)",
  "improvement-loop": "rgba(180, 160, 255, 0.6)",
  performance: "rgba(140, 200, 255, 0.6)",
  sessions: "rgba(160, 240, 200, 0.6)",
  skills: "rgba(180, 160, 255, 0.6)",
  "memory-files": "rgba(160, 240, 200, 0.6)",
  "hermes-live": "rgba(140, 200, 255, 0.7)",
  thinking: "rgba(180, 160, 255, 0.7)",
  mission: "rgba(208, 241, 0, 0.7)",
  memory: "rgba(160, 240, 200, 0.7)",
  "run-log": "rgba(224, 246, 255, 0.4)",
  "local-console": "rgba(224, 246, 255, 0.4)",
  changelog: "rgba(208, 241, 0, 0.4)",
  "code-search": "rgba(140, 200, 255, 0.6)",
  "subagent-tree": "rgba(180, 160, 255, 0.6)",
  "themed-surfaces": "rgba(208, 241, 0, 0.5)",
  "obsidian-graph": "rgba(160, 240, 200, 0.6)"
};

function isActionable(request: RunRequest) {
  return request.status === "pending";
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
      setLiveEvents(next.hermesEvents.slice(0, 60));
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

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore when typing in an input/textarea
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === "/") {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>('[data-pane-input="code-search"]');
        input?.focus();
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
    try {
      await approveRunRequest(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setBusy("");
    }
  }

  async function handleReject(id: string) {
    setBusy(`reject:${id}`);
    try {
      await rejectRunRequest(id, "Rejected in Pretext Console");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reject failed");
    } finally {
      setBusy("");
    }
  }

  async function handleLocalMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("message");
    try {
      await createLocalMessage(localMessage);
      setLocalMessage("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Local message failed");
    } finally {
      setBusy("");
    }
  }

  async function handleModelChange(event: React.ChangeEvent<HTMLSelectElement>) {
    setBusy("model");
    try {
      await setHermesModel(event.target.value);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Model switch failed");
    } finally {
      setBusy("");
    }
  }

  async function handleIntentDecision(intent: PublicIntent, decision: "confirm" | "decline") {
    setBusy(`intent:${intent.id}`);
    try {
      await decidePublicIntent(intent.id, decision, decision === "decline" ? { reason: "declined locally" } : {});
      setLiveIntents((prev) => prev.filter((item) => item.id !== intent.id));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Intent decision failed");
    } finally {
      setBusy("");
    }
  }

  async function handleProposalDecision(proposal: Proposal, decision: "confirm" | "decline") {
    setBusy(`prop:${proposal.id}`);
    try {
      await decideProposal(proposal.id, decision, decision === "decline" ? { reason: "declined locally" } : {});
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Proposal decision failed");
    } finally {
      setBusy("");
    }
  }

  async function handleResetLayout() {
    if (!window.confirm("Reset dashboard layout to defaults?")) return;
    await resetServerLayout();
    window.location.reload();
  }

  if (!payload) {
    return (
      <main className="console-stage loading-stage">
        <div className="loading-card">
          <span>PRETEXT_BOOT</span>
          <strong>reading local agent memory</strong>
        </div>
      </main>
    );
  }

  const runtime = payload.hermesRuntime;
  const knownModels = runtime?.knownModels?.length ? runtime.knownModels : [runtime?.model || "gemma4:e4b"];

  function renderPane(id: string, position: PanePosition, onPos: (id: string, p: PanePosition) => void, onFocus: (id: string) => void) {
    const title = PANE_TITLES[id];
    const accent = PANE_ACCENTS[id];
    return (
      <DraggablePane
        id={id}
        position={position}
        onPositionChange={onPos}
        onFocus={onFocus}
        title={title}
        accent={accent}
      >
        {paneBody(id, payload!, liveEvents, setInspectedEvent)}
      </DraggablePane>
    );
  }

  return (
    <main className="console-stage">
      <PretextConsole
        payload={payload}
        nodes={nodes}
        activeNode={activeNode}
        liveEvents={liveEvents}
      />

      <div className="top-bar">
        <div className="brand-mark" aria-label="Hermes Pretext Console">H</div>
        <select
          className="model-select"
          aria-label="Active Hermes model"
          value={runtime?.model || ""}
          onChange={handleModelChange}
          disabled={busy === "model"}
        >
          {knownModels.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
        <button className="button button-ghost refresh-button" onClick={refresh}>refresh</button>
        <button className="button button-ghost refresh-button" onClick={handleResetLayout}>reset layout</button>
        <span className="kbd-hint muted">/ search · g focus · p propose · m inspect · ? help</span>
      </div>

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

      <DraggableLayer paneIds={PANE_IDS} render={renderPane} />

      {payload.pendingProposals.length > 0 && (
        <aside className="proposal-dock" aria-label="Pending Hermes proposals">
          <header className="proposal-dock-header">HERMES_PROPOSALS · {payload.pendingProposals.length}</header>
          {payload.pendingProposals.slice(0, 4).map((proposal) => (
            <article className="proposal-row" key={proposal.id}>
              <header>
                <strong>◆ {proposal.title}</strong>
                <span className="proposal-kind"> ({proposal.kind})</span>
              </header>
              <p className="proposal-rationale">{proposal.rationale}</p>
              {proposal.command ? <code className="proposal-cmd">{proposal.command}</code> : null}
              {proposal.argv?.length ? <code className="proposal-cmd">{proposal.argv.join(" ")}</code> : null}
              <div className="proposal-actions">
                <button
                  className="button button-mini button-primary"
                  disabled={busy === `prop:${proposal.id}`}
                  onClick={() => handleProposalDecision(proposal, "confirm")}
                >
                  apply
                </button>
                <button
                  className="button button-mini button-light"
                  disabled={busy === `prop:${proposal.id}`}
                  onClick={() => handleProposalDecision(proposal, "decline")}
                >
                  decline
                </button>
                <button
                  className="button button-mini button-light"
                  onClick={() => setDiffProposal(proposal)}
                >
                  diff
                </button>
              </div>
            </article>
          ))}
        </aside>
      )}

      {liveIntents.length > 0 && (
        <aside className="intent-dock" aria-label="Pending public actions">
          {liveIntents.map((intent) => (
            <article className="intent-row" key={intent.id}>
              <header>
                <strong>{intent.action}</strong>
                <span> → {intent.surface} ({intent.audience})</span>
              </header>
              <p className="intent-content">{intent.content}</p>
              <p className="intent-meta">
                worst-case: {intent.worstCase} · legal: {intent.legalPosture} · rep: {intent.reputationPosture}
              </p>
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
              <button
                className="button button-mini button-primary"
                disabled={request.status !== "pending" || busy === `approve:${request.id}`}
                onClick={() => handleApprove(request.id)}
              >run</button>
              <button
                className="button button-mini button-light"
                disabled={busy === `reject:${request.id}`}
                onClick={() => handleReject(request.id)}
              >reject</button>
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
        <datalist id="suggested-commands">
          {SUGGESTED_COMMANDS.map((item) => <option key={item} value={item} />)}
        </datalist>
        <input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="native-submit-button" disabled={busy === "create"}>queue</button>
      </form>

      <InspectorOverlay event={inspectedEvent} onClose={() => setInspectedEvent(null)} />
      <DiffPreviewOverlay proposal={diffProposal} onClose={() => setDiffProposal(null)} />
    </main>
  );
}

function paneBody(id: string, payload: DashboardPayload, liveEvents: HermesEvent[], onSelectEvent: (e: HermesEvent) => void) {
  switch (id) {
    case "health":
      return <HealthPanel payload={payload} />;
    case "cadence":
      return <CadencePanel cadence={payload.cadence} />;
    case "sparkline":
      return (
        <SparklinePanel
          buckets={payload.timeline?.buckets || []}
          total={payload.timeline?.total || 0}
          peak={payload.timeline?.peak || 0}
        />
      );
    case "git-state":
      return <GitStatePanel git={payload.git} />;
    case "github-publish":
      return <GithubPublishPanel publishStatus={payload.publishStatus} />;
    case "improvement-loop":
      return <ImprovementLoopPanel payload={payload} />;
    case "performance":
      return <PerformancePanel payload={payload} />;
    case "sessions":
      return <SessionsPanel sessions={payload.sessions?.sessions || []} />;
    case "skills":
      return (
        <SkillsPanel
          skills={payload.skills?.skills || []}
          activeCount={payload.skills?.activeCount || 0}
          disabledCount={payload.skills?.disabledCount || 0}
          totalCount={payload.skills?.totalCount || 0}
        />
      );
    case "memory-files":
      return <MemoryFilesPanel files={payload.memoryFiles?.files || []} count={payload.memoryFiles?.count || 0} />;
    case "hermes-live":
      return <HermesLivePanel events={liveEvents} onSelect={onSelectEvent} />;
    case "thinking":
      return <ThinkingPanel mission={payload.mission} />;
    case "mission":
      return <MissionPanel mission={payload.mission} />;
    case "memory":
      return <MemoryPanel mission={payload.mission} events={liveEvents} />;
    case "run-log":
      return <RunLogPanel runs={payload.runRequests} />;
    case "local-console":
      return <LocalConsolePanel messages={payload.localMessages} />;
    case "changelog":
      return <ChangelogPanel entries={payload.changelog} />;
    case "code-search":
      return <CodeSearchPanel />;
    case "subagent-tree":
      return <SubagentTreePanel payload={payload} />;
    case "themed-surfaces":
      return <ThemedSurfacesPanel themed={payload.themed} />;
    case "obsidian-graph":
      return <ObsidianGraphPanel />;
    default:
      return <div className="muted">unknown pane: {id}</div>;
  }
}
