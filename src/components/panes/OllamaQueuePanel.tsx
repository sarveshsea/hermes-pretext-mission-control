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
    <div className="ollama-queue">
      <div className="ollama-rows">
        {models.map((m) => {
          const tone = m.consecutiveFails >= 3 ? "red" : m.consecutiveFails >= 1 ? "amber" : "green";
          return (
            <div key={m.model} className={`ollama-row ollama-row-${tone}`}>
              <span className="ollama-model">{m.model}</span>
              <span className="ollama-counts">
                <span className="ollama-counts-key">queue</span>
                <span className="ollama-counts-val">{m.queued}</span>
                <span className="ollama-counts-key">live</span>
                <span className="ollama-counts-val">{m.inFlight}</span>
                <span className="ollama-counts-key">ok</span>
                <span className="ollama-counts-val">{m.completed}</span>
                <span className="ollama-counts-key">fail</span>
                <span className={`ollama-counts-val ${m.consecutiveFails > 0 ? "warn" : ""}`}>{m.failed}</span>
              </span>
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
