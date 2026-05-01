import { useEffect, useState } from "react";
import type { DashboardPayload } from "../api";

type Props = {
  payload: DashboardPayload;
  eventCount: number;
};

type ClaudeStatus = {
  limitPerHour: number;
  inLastHour: number;
  remaining: number;
};

// Compact top zone replacing the kinetic JARVIS detail block. Dense but
// readable: model + uptime + throughput + claude budget + cadence in one
// 4-row card. No empty hex grid.
export default function HermesStatusCard({ payload, eventCount }: Props) {
  const [claude, setClaude] = useState<ClaudeStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/hermes/claude-dispatch-status", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setClaude(data);
      } catch {
        // best-effort
      }
    };
    void tick();
    const id = setInterval(tick, 12_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const runtime = payload.hermesRuntime;
  const cadence = payload.cadence;
  const rate1m = payload.mission?.rate1m ?? 0;
  const cadenceMode = cadence?.mode || "—";
  const intervalSec = Math.round((cadence?.recommendedIntervalMs || 0) / 1000);

  return (
    <div className="hermes-card" data-testid="hermes-status-card">
      <div className="hermes-card-row hermes-card-head">
        <span className="hermes-card-mark">HERMES</span>
        <span className="hermes-card-rate">{rate1m}/m</span>
      </div>
      <div className="hermes-card-grid">
        <div className="hermes-card-cell">
          <div className="hermes-card-key">MODEL</div>
          <div className="hermes-card-val">{runtime?.model || "—"}</div>
        </div>
        <div className="hermes-card-cell">
          <div className="hermes-card-key">CADENCE</div>
          <div className="hermes-card-val">{cadenceMode} · {intervalSec}s</div>
        </div>
        <div className="hermes-card-cell">
          <div className="hermes-card-key">EVENTS</div>
          <div className="hermes-card-val">{eventCount}</div>
        </div>
        <div className="hermes-card-cell">
          <div className="hermes-card-key">CLAUDE</div>
          <div className={`hermes-card-val ${claude && claude.remaining < 2 ? "warn" : ""}`}>
            {claude ? `${claude.remaining}/${claude.limitPerHour} left` : "—"}
          </div>
        </div>
      </div>
      {payload.mission?.headline ? (
        <div className="hermes-card-headline" title={payload.mission.headline}>
          <span className="hermes-card-prompt">$</span> {payload.mission.headline}
        </div>
      ) : null}
    </div>
  );
}
