import type { DashboardPayload } from "../../api";

type Props = { payload: DashboardPayload };

type Pill = { label: string; value: string; ok: boolean };

function buildPills(payload: DashboardPayload): Pill[] {
  const { health } = payload;
  return [
    { label: "OLLAMA", value: health?.ollama?.up ? `${health.ollama.latencyMs}ms · ${health.ollama.models.length}m` : "DOWN", ok: !!health?.ollama?.up },
    { label: "GATEWAY", value: health?.gateway?.running ? `pid${health.gateway.pid}` : "DOWN", ok: !!health?.gateway?.running },
    { label: "DASH", value: health?.dashboard?.running ? `pid${health.dashboard.pid}` : "DOWN", ok: !!health?.dashboard?.running },
    { label: "VAULT", value: health?.vault?.accessible ? "ok" : "missing", ok: !!health?.vault?.accessible },
    { label: "DISK", value: health?.disk?.freeGb != null ? `${health.disk.freeGb}GB free` : "?", ok: (health?.disk?.usedPct ?? 0) < 90 },
    { label: "PUSH", value: payload.git?.pushAuth?.ok ? "ok" : "fail", ok: !!payload.git?.pushAuth?.ok },
    { label: "MEM", value: health?.memory ? `${health.memory.usedPct}%` : "?", ok: (health?.memory?.usedPct ?? 100) < 90 },
    { label: "SCORE", value: `${health?.healthScore ?? 0}/100`, ok: (health?.healthScore ?? 0) >= 70 }
  ];
}

export default function HealthPanel({ payload }: Props) {
  const pills = buildPills(payload);
  return (
    <div className="pill-grid">
      {pills.map((p) => (
        <span key={p.label} className={`pill ${p.ok ? "pill-ok" : "pill-bad"}`}>
          <em>{p.label}</em> {p.value}
        </span>
      ))}
    </div>
  );
}
