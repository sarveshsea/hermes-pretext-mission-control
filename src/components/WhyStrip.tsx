import { useEffect, useState } from "react";

type Summaries = {
  pipeline?: string;
  thinking?: string;
  swarm?: string;
};

type Dots = Record<string, "green" | "amber" | "red">;

type DelegationStatus = {
  pendingDispatches?: number;
  lastResult?: string;
};

type PipelineStatus = {
  intervalMs: number;
  baseIntervalMs: number;
};

export default function WhyStrip() {
  const [summaries, setSummaries] = useState<Summaries>({});
  const [dots, setDots] = useState<Dots>({});
  const [delegation, setDelegation] = useState<DelegationStatus | null>(null);
  const [pipeline, setPipeline] = useState<PipelineStatus | null>(null);
  const [resetBusy, setResetBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const [sumRes, delRes, pipeRes] = await Promise.all([
          fetch("/api/hermes/pane-summaries", { cache: "no-store" }),
          fetch("/api/hermes/delegation", { cache: "no-store" }),
          fetch("/api/hermes/pipeline", { cache: "no-store" })
        ]);
        if (cancelled) return;
        if (sumRes.ok) {
          const data = await sumRes.json();
          setSummaries(data.summaries || {});
          setDots(data.dots || {});
        }
        if (delRes.ok) setDelegation(await delRes.json());
        if (pipeRes.ok) setPipeline(await pipeRes.json());
      } catch {
        // best-effort
      }
    };
    void tick();
    const id = setInterval(tick, 6_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const onResetCadence = async () => {
    setResetBusy(true);
    try {
      await fetch("/api/hermes/pipeline/cadence/reset", { method: "POST" });
    } finally {
      setResetBusy(false);
    }
  };

  const intentSummary = delegation?.pendingDispatches
    ? `${delegation.pendingDispatches} pending delegation${delegation.pendingDispatches > 1 ? "s" : ""} for your review`
    : "no pending delegations";
  const intentDot = delegation?.pendingDispatches ? "amber" : "green";
  const cadenceBackedOff = pipeline && pipeline.intervalMs > pipeline.baseIntervalMs;

  return (
    <div className="why-strip" data-testid="why-strip">
      <div className="why-cell why-thinking">
        <span className="why-label">THINKING</span>
        <span className={`why-dot why-dot-${dots.thinking || "amber"}`} aria-hidden>●</span>
        <span className="why-content">{summaries.thinking || "—"}</span>
      </div>
      <div className="why-cell why-pipeline">
        <span className="why-label">PIPELINE</span>
        <span className={`why-dot why-dot-${dots.pipeline || "amber"}`} aria-hidden>●</span>
        <span className="why-content">{summaries.pipeline || "—"}</span>
        {cadenceBackedOff ? (
          <button
            className="why-action"
            onClick={onResetCadence}
            disabled={resetBusy}
            title={`pipeline backed off to ${Math.round((pipeline?.intervalMs || 0) / 1000)}s — click to reset to ${Math.round((pipeline?.baseIntervalMs || 0) / 1000)}s`}
          >
            {resetBusy ? "…" : "reset"}
          </button>
        ) : null}
      </div>
      <div className="why-cell why-swarm">
        <span className="why-label">SWARM</span>
        <span className={`why-dot why-dot-${dots.swarm || "amber"}`} aria-hidden>●</span>
        <span className="why-content">{summaries.swarm || "—"}</span>
      </div>
      <div className="why-cell why-intent">
        <span className="why-label">AGENT INTENT</span>
        <span className={`why-dot why-dot-${intentDot}`} aria-hidden>●</span>
        <span className="why-content">{intentSummary}</span>
      </div>
    </div>
  );
}
