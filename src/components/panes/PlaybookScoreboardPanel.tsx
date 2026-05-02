import { useEffect, useState } from "react";

// Add data-testid to the root scoreboard container

type Outcome = { ts: string; result: "ship" | "fail"; diffLines?: number; reason?: string };
type StatRecord = { success: number; fail: number; totalDiffLines: number; recentOutcomes: Outcome[]; lastSeen?: string };
type Stats = Record<string, StatRecord>;

function relativeTime(iso?: string): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function bar(success: number, fail: number): string {
  const total = success + fail;
  if (total === 0) return "░░░░░░░░░░ —";
  const pct = success / total;
  const filled = Math.round(pct * 10);
  return "█".repeat(filled) + "░".repeat(10 - filled) + ` ${Math.round(pct * 100)}%`;
}

export default function PlaybookScoreboardPanel() {
  const [stats, setStats] = useState<Stats>({});

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/hermes/playbook-stats", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setStats(data.stats || {});
      } catch {
        // best-effort
      }
    };
    void tick();
    const id = setInterval(tick, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const ids = Object.keys(stats).sort((a, b) => {
    const sa = stats[a].success - stats[a].fail;
    const sb = stats[b].success - stats[b].fail;
    return sb - sa;
  });

  if (ids.length === 0) {
    return <div className="muted">no playbook outcomes yet · pipeline hasn't shipped</div>;
  }

  return (
    <div className="playbook-scoreboard" data-testid="pane-playbook-scoreboard">
      {ids.map((id) => {
        const r = stats[id];
        const total = r.success + r.fail;
        const last5 = (r.recentOutcomes || []).slice(-5);
        const recent = last5.map((o) => (o.result === "ship" ? "✓" : "✗")).join(" ");
        const lastFail = last5.slice().reverse().find((o) => o.result === "fail");
        const tooltipReason = lastFail?.reason
          ? `last fail: ${lastFail.reason}`
          : last5.length
            ? `last outcome: ${last5[last5.length - 1].result}`
            : "no outcomes yet";
        const sinceLast = relativeTime(r.lastSeen);
        return (
          <div key={id} className="pb-row" title={tooltipReason}>
            <span className="pb-id" title={id}>{id}</span>
            <span className="pb-bar">{bar(r.success, r.fail)}</span>
            <span className="pb-counts" title={`${r.success} shipped of ${total} attempts`}>
              {r.success}/{total}
            </span>
            <span className="pb-recent" title={tooltipReason}>{recent || "—"}</span>
            <span className="pb-since" title={`last seen ${r.lastSeen || "never"}`}>{sinceLast}</span>
          </div>
        );
      })}
    </div>
  );
}
