import { useEffect, useState } from "react";

type Draft = {
  ts: string;
  surface: string;
  reason: string;
  payload: Record<string, unknown>;
};

type DraftMap = Record<string, Draft[]>;

const SURFACES = [
  { id: "buzzr_drafts", label: "BUZZR" },
  { id: "sports_radar", label: "SPORTS" },
  { id: "memoire_audits", label: "MEMOIRE" },
  { id: "design_lab", label: "DESIGN" }
];

// What the agent TRIED to write but the quality gate rejected. So you can
// see the slop before it lands in the curated panes — and tighten the gate
// or the prompt if too many real ones get rejected.
export default function DraftPoolPanel() {
  const [data, setData] = useState<DraftMap>({});
  const [active, setActive] = useState("buzzr_drafts");

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/hermes/draft-pool", { cache: "no-store" });
        if (!res.ok) return;
        const next = await res.json();
        if (!cancelled) setData(next.surfaces || {});
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

  const items = (data[active] || []).slice().reverse().slice(0, 12);

  return (
    <div className="draft-pool" data-testid="pane-draft-pool">
      <div className="draft-pool-tabs">
        {SURFACES.map((s) => (
          <button
            key={s.id}
            className={`draft-pool-tab ${active === s.id ? "active" : ""}`}
            onClick={() => setActive(s.id)}
          >
            {s.label}
            {data[s.id]?.length ? <span className="draft-pool-count">{data[s.id].length}</span> : null}
          </button>
        ))}
      </div>
      {items.length === 0 ? (
        <div className="muted">no rejections · gate not catching slop or none generated</div>
      ) : (
        <ul className="draft-pool-list">
          {items.map((d, i) => {
            const sample = (d.payload?.text || d.payload?.headline || d.payload?.source || JSON.stringify(d.payload)).toString().slice(0, 90);
            return (
              <li key={`${d.ts}-${i}`} className="draft-pool-row" title={sample}>
                <span className="draft-pool-time muted">{d.ts.slice(11, 19)}</span>
                <span className="draft-pool-reason">{d.reason}</span>
                <span className="draft-pool-sample">{sample}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
