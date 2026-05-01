import type { Cadence } from "../../api";

export default function CadencePanel({ cadence }: { cadence: Cadence }) {
  const idleMin = Math.floor(cadence.idleSec / 60);
  const idleSec = cadence.idleSec % 60;
  const idleLabel = idleMin > 0 ? `${idleMin}m${idleSec}s` : `${cadence.idleSec}s`;
  const tone = cadence.mode === "asleep" ? "alert" : cadence.mode === "idle" ? "warm" : "neutral";
  return (
    <div className="pill-grid">
      <span className={`pill pill-${tone}`}>
        <em>MODE</em> {cadence.mode.toUpperCase()}
      </span>
      <span className="pill pill-neutral">
        <em>IDLE</em> {idleLabel}
      </span>
      <span className={`pill ${cadence.throttle > 0.7 ? "pill-ok" : "pill-neutral"}`}>
        <em>THROTTLE</em> {cadence.throttle.toFixed(2)}
      </span>
      <span className="pill pill-neutral">
        <em>INTERVAL</em> {Math.round(cadence.recommendedIntervalMs / 1000)}s
      </span>
      <span className={`pill ${cadence.recommendedAutoApply ? "pill-ok" : "pill-neutral"}`}>
        <em>AUTO-APPLY</em> {cadence.recommendedAutoApply ? "ARMED" : "off"}
      </span>
      <span className={`pill ${cadence.loadAvg > 3 ? "pill-alert" : "pill-neutral"}`}>
        <em>LOAD</em> {cadence.loadAvg.toFixed(2)}
      </span>
    </div>
  );
}
