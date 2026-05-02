import { useEffect, useState } from "react";
import type { DashboardPayload } from "../../api";

type Props = { payload: DashboardPayload; eventCount: number };

type ModelStat = { model: string; queued: number; inFlight: number; completed: number; failed: number; consecutiveFails: number };
type QueueStatus = { models: Record<string, ModelStat> };
type HealthProbe = {
  ollama?: { up: boolean; latencyMs: number | null; models?: { name: string }[] };
  gateway?: { running: boolean; pid: number | null };
  dashboard?: { running: boolean; pid: number | null };
};
type Perf = {
  node?: { rssMb?: number };
  cpu?: { loadAvg?: number[]; cores?: number };
};

// One consolidated widget that replaces the four cramped top cells
// (HEALTH | CADENCE | EVENTS | PERFORMANCE) with a single pulse strip.
// Information density >> four squished cells with truncated badges.
//
// Layout: 5 evenly-spaced micro-cards across one row.
//   [SYSTEM] · [GATEWAY] · [CADENCE] · [EVENTS] · [QUEUE]
//
// Each micro-card has a label, a metric, and a status dot.
export default function SystemPulsePanel({ payload, eventCount }: Props) {
  const [queue, setQueue] = useState<QueueStatus | null>(null);
  const [health, setHealth] = useState<HealthProbe | null>(null);
  const [perf, setPerf] = useState<Perf | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const [q, h, p] = await Promise.all([
          fetch("/api/hermes/ollama-queue", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
          fetch("/api/hermes/health", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
          fetch("/api/hermes/perf", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
        ]);
        if (cancelled) return;
        if (q) setQueue(q);
        if (h) setHealth(h);
        if (p) setPerf(p);
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

  const cadence = payload.cadence;
  const cadenceMode = cadence?.mode || "—";
  const intervalSec = Math.round((cadence?.recommendedIntervalMs || 0) / 1000);
  const idleSec = cadence?.idleSec ?? 0;

  const queueModels = queue ? Object.values(queue.models) : [];
  const totalInFlight = queueModels.reduce((acc, m) => acc + m.inFlight, 0);
  const totalQueued = queueModels.reduce((acc, m) => acc + m.queued, 0);
  const totalFails = queueModels.reduce((acc, m) => acc + m.consecutiveFails, 0);
  const queueDot = totalFails >= 3 ? "red" : totalFails > 0 || totalQueued > 5 ? "amber" : "green";

  const ollamaOk = health?.ollama?.up;
  const ollamaLat = health?.ollama?.latencyMs ?? null;
  const ollamaModels = health?.ollama?.models?.length ?? 0;
  const gatewayPid = health?.gateway?.pid ?? null;
  const dashPid = health?.dashboard?.pid ?? null;

  const eventsPeak = payload.timeline?.peak ?? 0;
  const cpuLoad = perf?.cpu?.loadAvg?.[0]?.toFixed?.(1) ?? "—";
  const memMb = perf?.node?.rssMb ?? "—";

  return (
    <div className="system-pulse" data-testid="pane-system-pulse">
      <div className="sp-card">
        <div className="sp-head">
          <span className="sp-label">OLLAMA</span>
          <span className={`sp-dot sp-dot-${ollamaOk ? "green" : "red"}`} aria-hidden>●</span>
        </div>
        <div className="sp-value" title={`Ollama daemon · ${ollamaLat ?? "?"}ms last probe`}>
          {ollamaOk ? `${ollamaLat ?? "?"}ms` : "down"}
        </div>
        <div className="sp-meta muted">{ollamaModels || queueModels.length} models loaded</div>
      </div>

      <div className="sp-card">
        <div className="sp-head">
          <span className="sp-label">GATEWAY</span>
          <span className={`sp-dot sp-dot-${gatewayPid ? "green" : "red"}`} aria-hidden>●</span>
        </div>
        <div className="sp-value" title="Hermes gateway PID">
          pid {gatewayPid || "—"}
        </div>
        <div className="sp-meta muted" title="dashboard pid">dash {dashPid || "—"}</div>
      </div>

      <div className="sp-card">
        <div className="sp-head">
          <span className="sp-label">CADENCE</span>
          <span className={`sp-dot sp-dot-${cadenceMode === "active" ? "green" : cadenceMode === "idle" ? "amber" : "muted"}`} aria-hidden>●</span>
        </div>
        <div className="sp-value" title={`mode ${cadenceMode} · interval ${intervalSec}s · idle ${idleSec}s`}>
          {cadenceMode}
        </div>
        <div className="sp-meta muted">{intervalSec}s · idle {idleSec}s</div>
      </div>

      <div className="sp-card">
        <div className="sp-head">
          <span className="sp-label">EVENTS</span>
          <span className="sp-dot sp-dot-green" aria-hidden>●</span>
        </div>
        <div className="sp-value" title={`${eventCount} live · peak ${eventsPeak}/min`}>
          {eventCount}
        </div>
        <div className="sp-meta muted">peak {eventsPeak}/min</div>
      </div>

      <div className="sp-card">
        <div className="sp-head">
          <span className="sp-label">QUEUE</span>
          <span className={`sp-dot sp-dot-${queueDot}`} aria-hidden>●</span>
        </div>
        <div className="sp-value" title={`${totalInFlight} live · ${totalQueued} waiting · ${totalFails} fails`}>
          {totalInFlight}<span className="sp-sub">/{totalQueued}</span>
        </div>
        <div className="sp-meta muted">cpu {cpuLoad} · mem {memMb}M</div>
      </div>
    </div>
  );
}
