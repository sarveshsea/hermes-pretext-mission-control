import { useEffect, useState } from "react";

type PowerMetrics = {
  generatedAt: string;
  windowMinutes: number;
  tasks_closed_per_hour: number;
  tasks_done_per_hour: number;
  proposals_accepted_per_hour: number;
  proposals_rejected_per_hour: number;
  unique_files_modified_per_hour: number;
  pipeline_picks: number;
  pipeline_submits: number;
  pipeline_abandons: number;
  pipeline_success_rate: number;
};

function bigNumberClass(value: number): string {
  return value > 0 ? "power-num power-num-on" : "power-num power-num-off";
}

export default function PowerMetricsPanel() {
  const [m, setM] = useState<PowerMetrics | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/hermes/power-metrics?minutes=60", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as PowerMetrics;
        if (!cancelled) setM(data);
      } catch {
        // best-effort
      }
    };
    void tick();
    const interval = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!m) return <div className="muted">probing power metrics…</div>;

  return (
    <div className="power-metrics">
      <div className="power-grid">
        <div className="power-cell">
          <div className={bigNumberClass(m.tasks_done_per_hour)}>{m.tasks_done_per_hour}</div>
          <div className="power-label">tasks done / hr</div>
        </div>
        <div className="power-cell">
          <div className={bigNumberClass(m.proposals_accepted_per_hour)}>{m.proposals_accepted_per_hour}</div>
          <div className="power-label">proposals applied / hr</div>
        </div>
        <div className="power-cell">
          <div className={bigNumberClass(m.unique_files_modified_per_hour)}>{m.unique_files_modified_per_hour}</div>
          <div className="power-label">files modified / hr</div>
        </div>
        <div className="power-cell">
          <div className={bigNumberClass(m.pipeline_success_rate)}>{m.pipeline_success_rate}<span className="power-suffix">%</span></div>
          <div className="power-label">pipeline submit rate</div>
        </div>
      </div>
      <div className="power-detail">
        <span>pipeline {m.pipeline_picks} picked → {m.pipeline_submits} submitted, {m.pipeline_abandons} abandoned</span>
        <span className="muted"> · rejected {m.proposals_rejected_per_hour}, closed (any) {m.tasks_closed_per_hour}</span>
      </div>
    </div>
  );
}
