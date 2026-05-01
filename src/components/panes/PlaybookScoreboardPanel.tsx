import { useEffect, useState } from "react";

type Outcome = { ts: string; result: "ship" | "fail"; diffLines?: number; reason?: string };
type StatRecord = { success: number; fail: number; totalDiffLines: number; recentOutcomes: Outcome[]; lastSeen?: string };
type Stats = Record<string, StatRecord>;

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
    <div className="playbook-scoreboard">
      {ids.map((id) => {
        const r = stats[id];
        const total = r.success + r.fail;
        const recent = (r.recentOutcomes || []).slice(-5).map((o) => (o.result === "ship" ? "✓" : "✗")).join(" ");
        return (
          <div key={id} className="pb-row">
            <span className="pb-id">{id}</span>
            <span className="pb-bar">{bar(r.success, r.fail)}</span>
            <span className="pb-counts">
              {r.success}/{total}
            </span>
            <span className="pb-recent" title="recent outcomes">{recent || "—"}</span>
          </div>
        );
      })}
    </div>
  );
}
