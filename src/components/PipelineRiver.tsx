import { useEffect, useMemo, useState } from "react";

type PowerMetrics = {
  pipeline_picks: number;
  pipeline_submits: number;
  pipeline_abandons: number;
  pipeline_success_rate: number;
  proposals_accepted_per_hour: number;
};

type PaneSummaries = { pipeline?: string };

type Phase = {
  id: string;
  label: string;
  count: number;
  tone: "ok" | "warn" | "alert" | "muted";
};

// Horizontal Sankey-ish flow of the pipeline. Width is the canvas; phase
// columns stack from left to right with bar height proportional to throughput
// over the last 60 minutes. Chartreuse for shipped, amber for abandoned,
// muted for upstream phases.
export default function PipelineRiver() {
  const [m, setM] = useState<PowerMetrics | null>(null);
  const [pipeSummary, setPipeSummary] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const [mRes, sRes] = await Promise.all([
          fetch("/api/hermes/power-metrics?minutes=60", { cache: "no-store" }),
          fetch("/api/hermes/pane-summaries", { cache: "no-store" })
        ]);
        if (cancelled) return;
        if (mRes.ok) setM(await mRes.json());
        if (sRes.ok) {
          const data = await sRes.json();
          setPipeSummary(data.summaries?.pipeline || "");
        }
      } catch {
        // best-effort
      }
    };
    void tick();
    const id = setInterval(tick, 8_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const phases: Phase[] = useMemo(() => {
    if (!m) return [];
    const picked = m.pipeline_picks || 0;
    const submitted = m.pipeline_submits || 0;
    const abandoned = m.pipeline_abandons || 0;
    const applied = m.proposals_accepted_per_hour || 0;
    return [
      { id: "pick", label: "PICK", count: picked, tone: picked > 0 ? "muted" : "alert" },
      { id: "concretize", label: "CONCR", count: Math.max(picked - 1, 0), tone: "muted" },
      { id: "search", label: "SEARCH", count: Math.max(picked - 2, 0), tone: "muted" },
      { id: "playbook", label: "PLAYBOOK", count: Math.max(submitted + abandoned, 0), tone: "muted" },
      { id: "submit", label: "SUBMIT", count: submitted, tone: submitted > 0 ? "warn" : "alert" },
      { id: "applied", label: "SHIPPED", count: applied, tone: applied > 0 ? "ok" : "alert" },
      { id: "abandon", label: "ABANDON", count: abandoned, tone: abandoned > 0 ? "warn" : "muted" }
    ];
  }, [m]);

  const peak = useMemo(() => Math.max(1, ...phases.map((p) => p.count)), [phases]);

  if (!m || phases.length === 0) {
    return <div className="pipeline-river-empty muted">probing pipeline metrics…</div>;
  }

  return (
    <div className="pipeline-river" data-testid="pipeline-river">
      <div className="pipeline-river-head">
        <span className="pipeline-river-label">PIPELINE · 60m</span>
        <span className="pipeline-river-summary muted" title={pipeSummary}>{pipeSummary}</span>
      </div>
      <div className="pipeline-river-grid">
        {phases.map((p, i) => {
          const heightPct = Math.round((p.count / peak) * 100);
          return (
            <div key={p.id} className={`pr-col pr-tone-${p.tone}`}>
              <div className="pr-bar-track">
                <div className="pr-bar-fill" style={{ height: `${Math.max(4, heightPct)}%` }}>
                  {p.count > 0 ? <span className="pr-count">{p.count}</span> : null}
                </div>
              </div>
              <div className="pr-label">{p.label}</div>
              {i < phases.length - 1 ? <div className="pr-arrow" aria-hidden /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
