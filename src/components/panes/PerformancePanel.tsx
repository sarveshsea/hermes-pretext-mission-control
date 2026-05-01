import { useEffect, useRef, useState } from "react";
import type { DashboardPayload } from "../../api";

type Sample = { tps: number; at: number };

export default function PerformancePanel({ payload }: { payload: DashboardPayload }) {
  const [samples, setSamples] = useState<Sample[]>([]);
  const probeRef = useRef<number | null>(null);
  const perf = payload.perf;

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const res = await fetch("/api/hermes/perf?speed=true", { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        const tps = data?.speed?.tokensPerSec ?? 0;
        if (tps > 0) {
          setSamples((prev) => [...prev.slice(-29), { tps, at: Date.now() }]);
        }
      } catch {
        // ignore
      }
    };
    void probe();
    probeRef.current = window.setInterval(probe, 30_000);
    return () => {
      cancelled = true;
      if (probeRef.current) window.clearInterval(probeRef.current);
    };
  }, []);

  const peakTps = Math.max(1, ...samples.map((s) => s.tps), 1);
  const memUsed = perf?.memory?.totalGb ? perf.memory.totalGb - (perf.memory.freeGb || 0) : 0;
  const memPct = perf?.memory?.totalGb ? Math.round((memUsed / perf.memory.totalGb) * 100) : 0;
  const load = perf?.cpu?.loadAvg?.[0] ?? 0;

  return (
    <div className="perf">
      <div className="perf-spark">
        <div className="perf-spark-head">
          <span>tokens/sec</span>
          <span className="muted">peak {peakTps.toFixed(1)} · n={samples.length}</span>
        </div>
        <div className="sparkline-bars">
          {samples.map((s, idx) => (
            <span
              key={idx}
              className="spark-bar spark-on"
              style={{ height: `${(s.tps / peakTps) * 100}%` }}
              title={`${s.tps.toFixed(1)} tps`}
            />
          ))}
          {samples.length === 0 && <span className="muted">probing…</span>}
        </div>
      </div>
      <div className="kv">
        <div className="kv-row">
          <span className="kv-key">cpu load</span>
          <span className={`kv-val ${load > 4 ? "warn" : "ok"}`}>{load.toFixed(2)}</span>
          <span className="kv-key">mem</span>
          <span className={`kv-val ${memPct > 90 ? "warn" : "ok"}`}>{memPct}%</span>
        </div>
        <div className="kv-row">
          <span className="kv-key">node rss</span>
          <span className="kv-val">{perf?.node?.rssMb || 0}MB</span>
          <span className="kv-key">heap</span>
          <span className="kv-val">{perf?.node?.heapUsedMb || 0}MB</span>
        </div>
        <div className="kv-row">
          <span className="kv-key">uptime</span>
          <span className="kv-val">{perf?.node?.uptimeSec || 0}s</span>
          <span className="kv-key">resident</span>
          <span className="kv-val">{perf?.ollama?.residentModels?.length || 0} models</span>
        </div>
      </div>
    </div>
  );
}
