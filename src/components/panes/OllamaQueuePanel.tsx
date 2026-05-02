import { useEffect, useState } from "react";

type ModelStat = {
  model: string;
  inFlight: number;
  queued: number;
  completed: number;
  failed: number;
  consecutiveFails: number;
  lastError: string | null;
  lastSuccessAt: string | null;
  lastFailAt: string | null;
};

type HealthStatus = {
  lastRestartAt: string | null;
  lastRestartReason: string | null;
  lastRestartResult: string | null;
  totalAttempts: number;
};

type QueueStatus = {
  models: Record<string, ModelStat>;
  health: HealthStatus;
};

export default function OllamaQueuePanel() {
  const [data, setData] = useState<QueueStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/hermes/ollama-queue", { cache: "no-store" });
        if (!res.ok) return;
        const next = await res.json();
        if (!cancelled) setData(next);
      } catch {
        // best-effort
      }
    };
    void tick();
    const id = setInterval(tick, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!data) return <div className="muted">probing ollama queue…</div>;
  const models = Object.values(data.models || {});
  if (!models.length) return <div className="muted">no model traffic yet</div>;

  return (
    <div className="ollama-queue" data-testid="pane-ollama-queue">
      <div className="ollama-rows">
        {models.map((m) => {
          const tone = m.consecutiveFails >= 3 ? "red" : m.consecutiveFails >= 1 ? "amber" : "green";
          return (
            <div key={m.model} className={`ollama-row ollama-row-${tone}`}>
              <span className="ollama-model" title={m.model}>{m.model}</span>
              <div className="ollama-counts">
                <div className="oc-pair" title={`${m.queued} queued`}>
                  <span className="oc-key">QUEUE</span>
                  <span className="oc-val">{m.queued}</span>
                </div>
                <div className="oc-pair" title={`${m.inFlight} in flight`}>
                  <span className="oc-key">LIVE</span>
                  <span className="oc-val">{m.inFlight}</span>
                </div>
                <div className="oc-pair" title={`${m.completed} completed`}>
                  <span className="oc-key">OK</span>
                  <span className="oc-val">{m.completed}</span>
                </div>
                <div className="oc-pair" title={`${m.failed} failed total · ${m.consecutiveFails} consecutive`}>
                  <span className="oc-key">FAIL</span>
                  <span className={`oc-val ${m.consecutiveFails > 0 ? "warn" : ""}`}>{m.failed}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {data.health?.lastRestartAt ? (
        <div className="ollama-health muted">
          last restart {data.health.lastRestartAt.slice(11, 19)} — {data.health.lastRestartResult || data.health.lastRestartReason || "—"}
        </div>
      ) : (
        <div className="ollama-health muted">no restarts triggered</div>
      )}
    </div>
  );
}
