import { useEffect, useState } from "react";

type Entry = { sha: string; ts: string; subject: string; kind: string };

function rel(iso?: string): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "now";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
}

export default function LastShippedChip() {
  const [entry, setEntry] = useState<Entry | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/hermes/improvements-log?minutes=1440", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setEntry(data?.entries?.[0] || null);
      } catch {
        // best-effort
      }
    };
    void tick();
    const id = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!entry) return <span className="last-shipped muted" title="no recent commits">no ship yet</span>;
  return (
    <span className="last-shipped" title={`${entry.sha} · ${entry.subject}`}>
      <span className="last-shipped-dot" aria-hidden>●</span>
      <span className="last-shipped-sha">{entry.sha}</span>
      <span className="last-shipped-time muted">{rel(entry.ts)} ago</span>
    </span>
  );
}
