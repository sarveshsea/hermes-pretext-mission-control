import type { DashboardPayload } from "../../api";

export default function ImprovementLoopPanel({ payload }: { payload: DashboardPayload }) {
  const loop = payload.status.improvementLoop;
  return (
    <div className="kv">
      <div className="kv-row">
        <span className="kv-key">state</span>
        <span className={`kv-val ${loop?.state === "running" ? "ok" : "muted"}`}>
          {loop?.state || "boot"}
        </span>
      </div>
      <div className="kv-row">
        <span className="kv-key">autopush</span>
        <span className={`kv-val ${loop?.autoPublish ? "ok" : "muted"}`}>
          {loop?.autoPublish ? "on" : "off"}
        </span>
      </div>
      <div className="kv-row">
        <span className="kv-key">events</span>
        <span className="kv-val">{payload.improvementEvents.length}</span>
      </div>
      <div className="kv-row">
        <span className="kv-key">last</span>
        <span className="kv-val truncate muted">
          {payload.improvementEvents[0]?.title || "—"}
        </span>
      </div>
    </div>
  );
}
