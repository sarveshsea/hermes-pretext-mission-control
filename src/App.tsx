import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  approveRunRequest,
  createLocalMessage,
  createRunRequest,
  decidePublicIntent,
  fetchDashboard,
  rejectRunRequest,
  setHermesModel,
  subscribeHermesStream,
  type DashboardPayload,
  type HermesEvent,
  type PublicIntent,
  type RunRequest
} from "./api";
import { buildConsoleNodes, type ConsoleNodeId } from "./consoleModel";
import PretextConsole from "./components/PretextConsole";
import PretextDock from "./components/PretextDock";

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

function requestLabel(request: RunRequest) {
  if (request.status === "pending") return "ready";
  return request.status;
}

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
      onEvent: (event) => {
        setLiveEvents((prev) => [event, ...prev].slice(0, 80));
      },
      onPublicIntent: (intent) => {
        setLiveIntents((prev) => {
          if (intent.status === "pending") {
            const without = prev.filter((item) => item.id !== intent.id);
            return [intent, ...without];
          }
          return prev.filter((item) => item.id !== intent.id);
        });
      }
    });
    return off;
  }, []);

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
      setActiveNode("run-queue");
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
      setActiveNode("run-queue");
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
      setActiveNode("run-queue");
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
      setActiveNode("local-console");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Local message failed");
    } finally {
      setBusy("");
    }
  }

  async function handleModelChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value;
    setBusy("model");
    try {
      await setHermesModel(next);
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

  return (
    <main className="console-stage">
      <PretextConsole
        payload={payload}
        nodes={nodes}
        activeNode={activeNode}
        liveEvents={liveEvents}
        pendingIntents={liveIntents}
      />

      <div className="top-bar">
        <div className="brand-mark" aria-label="Hermes Pretext Console">
          H
        </div>
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
        <button className="button button-ghost refresh-button" onClick={refresh} aria-label="Refresh console">
          refresh
        </button>
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
                <button
                  className="button button-mini button-primary"
                  disabled={busy === `intent:${intent.id}`}
                  onClick={() => handleIntentDecision(intent, "confirm")}
                >
                  confirm
                </button>
                <button
                  className="button button-mini button-light"
                  disabled={busy === `intent:${intent.id}`}
                  onClick={() => handleIntentDecision(intent, "decline")}
                >
                  decline
                </button>
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
              <em className={`request-status request-status-${requestLabel(request)}`}>{requestLabel(request)}</em>
              <button
                className="button button-mini button-primary"
                disabled={request.status !== "pending" || busy === `approve:${request.id}`}
                onClick={() => handleApprove(request.id)}
              >
                run
              </button>
              <button
                className="button button-mini button-light"
                disabled={busy === `reject:${request.id}`}
                onClick={() => handleReject(request.id)}
              >
                reject
              </button>
            </article>
          ))}
        </aside>
      )}

      <form className="message-dock" onSubmit={handleLocalMessage} aria-label="Send local message to Hermes">
        <PretextDock mode="message" value={localMessage} busy={busy === "message"} />
        <input
          className="native-message-input"
          aria-label="Local message"
          value={localMessage}
          onChange={(event) => setLocalMessage(event.target.value)}
          placeholder="message hermes locally..."
        />
        <button
          className="native-submit-button"
          disabled={busy === "message" || !localMessage.trim()}
          aria-label="Send local message"
        >
          send
        </button>
      </form>

      <form className="command-dock" onSubmit={handleCreate} aria-label="Create local run request">
        <PretextDock mode="command" value={command} detail={reason} busy={busy === "create"} />
        <input
          className="command-input"
          aria-label="Command"
          value={command}
          list="suggested-commands"
          onChange={(event) => setCommand(event.target.value)}
          placeholder="any shell command..."
        />
        <datalist id="suggested-commands">
          {SUGGESTED_COMMANDS.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
        <input aria-label="Reason" value={reason} onChange={(event) => setReason(event.target.value)} />
        <button className="native-submit-button" disabled={busy === "create"} aria-label="Queue run request">
          queue
        </button>
      </form>
    </main>
  );
}
