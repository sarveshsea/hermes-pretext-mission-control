import { useEffect, useState } from "react";

// Add data-testid to the root pane element

type Goal = { title: string; deadline: string | null; target: string; progress: string };

export default function GoalsPanel() {
  const [goals, setGoals] = useState<Goal[]>([]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/hermes/goals", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setGoals(data.goals || []);
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

  if (goals.length === 0) return <div className="muted">no goals defined · edit ~/.hermes/memories/goals.md</div>;

  return (
    <div className="goals-pane" data-testid="pane-goals">
      {goals.map((g) => {
        // Parse "X / Y" or freeform progress.
        const m = (g.progress || "").match(/^(\d+)\s*\/\s*(\d+)/);
        const pct = m ? Math.min(100, Math.round((Number(m[1]) / Math.max(1, Number(m[2]))) * 100)) : null;
        return (
          <div key={g.title} className="goal-row">
            <div className="goal-head">
              <span className="goal-title">{g.title}</span>
              {g.deadline ? <span className="goal-deadline">{g.deadline}</span> : null}
            </div>
            {g.target ? <div className="goal-target muted">{g.target}</div> : null}
            <div className="goal-progress">
              {pct !== null ? (
                <>
                  <span className="goal-bar">
                    <span className="goal-bar-fill" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="goal-pct">{g.progress}</span>
                </>
              ) : (
                <span className="muted">{g.progress || "—"}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
