import type { MissionState } from "../../api";

function clip(s: string, n: number) {
  if (!s) return "—";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export default function MissionPanel({ mission }: { mission: MissionState }) {
  const runtime = mission?.runtime;
  return (
    <div className="kv">
      <div className="kv-row">
        <span className="kv-key">headline</span>
        <span className="kv-val truncate">{clip(mission?.headline || "idle", 60)}</span>
      </div>
      <div className="kv-row">
        <span className="kv-key">model</span>
        <span className="kv-val">{runtime?.model || "?"}</span>
        <span className="kv-key">iter</span>
        <span className="kv-val">{runtime?.iteration ?? 0}</span>
      </div>
      <div className="kv-row">
        <span className="kv-key">rate</span>
        <span className="kv-val">1m {mission?.rate1m ?? 0} · 5m {mission?.rate5m ?? 0}</span>
      </div>
      <div className="kv-row">
        <span className="kv-key">last in</span>
        <span className="kv-val truncate muted">{clip((mission?.lastInbound?.content || "").replace(/\s+/g, " "), 60)}</span>
      </div>
      <div className="kv-row">
        <span className="kv-key">last out</span>
        <span className="kv-val truncate muted">{clip((mission?.lastOutbound?.content || "").replace(/\s+/g, " "), 60)}</span>
      </div>
    </div>
  );
}
