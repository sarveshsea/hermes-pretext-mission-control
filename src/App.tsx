import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  approveRunRequest,
  createLocalMessage,
  createRunRequest,
  fetchDashboard,
  rejectRunRequest,
  type DashboardPayload,
  type RunRequest
} from "./api";
import { buildConsoleNodes, type ConsoleNodeId } from "./consoleModel";
import PretextConsole from "./components/PretextConsole";
import PretextDock from "./components/PretextDock";

const POLL_MS = 12_000;
const DEFAULT_NODE: ConsoleNodeId = "hermes";
const ALLOWLISTED_COMMANDS = ["npm run check", "npm run build", "npm test", "npm run typecheck", "npm run dev"];

function requestLabel(request: RunRequest) {
  if (request.status === "pending" && request.allowed) return "ready";
  if (request.status === "blocked") return "blocked";
  return request.status;
}

function isActionable(request: RunRequest) {
  return request.status === "pending" || request.status === "blocked";
}

export default function App() {
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [activeNode, setActiveNode] = useState<ConsoleNodeId>(DEFAULT_NODE);
  const [command, setCommand] = useState(ALLOWLISTED_COMMANDS[0]);
  const [reason, setReason] = useState("local console improvement check");
  const [localMessage, setLocalMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    try {
      setPayload(await fetchDashboard());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dashboard refresh failed");
    }
  }

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const nodes = useMemo(() => (payload ? buildConsoleNodes(payload) : []), [payload]);
  const actionableRequests = useMemo(() => payload?.runRequests.filter(isActionable).slice(0, 4) ?? [], [payload]);

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

  return (
    <main className="console-stage">
      <PretextConsole payload={payload} nodes={nodes} activeNode={activeNode} />

      <div className="top-bar">
        <div className="brand-mark" aria-label="Hermes Pretext Console">
          H
        </div>
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

      {(actionableRequests.length || error) && (
        <aside className="run-dock" aria-label="Actionable run requests">
          {error ? <div className="error-banner">{error}</div> : null}
          {actionableRequests.map((request) => (
            <article className="request-row" key={request.id}>
              <code>{request.command || "empty"}</code>
              <em className={`request-status request-status-${requestLabel(request)}`}>{requestLabel(request)}</em>
              <button
                className="button button-mini button-primary"
                disabled={!request.allowed || request.status !== "pending" || busy === `approve:${request.id}`}
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
        <button className="native-submit-button" disabled={busy === "message" || !localMessage.trim()} aria-label="Send local message">
          send
        </button>
      </form>

      <form className="command-dock" onSubmit={handleCreate} aria-label="Create local run request">
        <PretextDock mode="command" value={command} detail={reason} busy={busy === "create"} />
        <select aria-label="Command" value={command} onChange={(event) => setCommand(event.target.value)}>
          {ALLOWLISTED_COMMANDS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <input aria-label="Reason" value={reason} onChange={(event) => setReason(event.target.value)} />
        <button className="native-submit-button" disabled={busy === "create"} aria-label="Queue run request">
          queue
        </button>
      </form>
    </main>
  );
}
