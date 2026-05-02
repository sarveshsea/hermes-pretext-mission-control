import { useEffect, useState } from "react";

type Subscription = {
  id: string;
  provider: string;
  intent: string;
  status: string;
  createdAt: string;
  notes?: string[];
};

type DelegationStatus = {
  state: string;
  lastTickAt: string | null;
  lastResult: string;
  pendingDispatches: number;
  dispatched: { class: string; at: string }[];
};

// The agent's "I'm stuck, please advise" outbox. agentDelegation.mjs scans
// abandons and queues subscription tasks here; Sarvesh approves or declines.
// Replaces the OBSIDIAN_GRAPH cell — same area, much higher signal/value.
export default function DelegationInboxPanel() {
  const [items, setItems] = useState<Subscription[]>([]);

{items.length === 0 && (
  <div className="muted">
    Hermes auto-fires Claude Code unless an intent matches a danger pattern.
  </div>
)}
  const [status, setStatus] = useState<DelegationStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const [subsRes, statRes] = await Promise.all([
          fetch("/api/hermes/subscriptions?status=queued", { cache: "no-store" }),
          fetch("/api/hermes/delegation", { cache: "no-store" })
        ]);
        if (cancelled) return;
        if (subsRes.ok) {
          const data = await subsRes.json();
          const list = Array.isArray(data) ? data : data.tasks || [];
          setItems(list.slice(0, 8));
        }
        if (statRes.ok) setStatus(await statRes.json());
      } catch {
        // best-effort
      }
    };
    void tick();
    const id = setInterval(tick, 8_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="delegation-inbox" data-testid="pane-delegation-inbox">
      <div className="delegation-bar">
        <span className="delegation-count">{items.length} pending</span>
        <span className="delegation-meta muted">
          {status?.lastResult || "—"}
          {status?.dispatched?.length ? ` · ${status.dispatched.length} class${status.dispatched.length > 1 ? "es" : ""} flagged` : ""}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="muted">no pending delegations · agent isn't stuck</div>
      ) : (
        <ul className="delegation-list">
          {items.map((s) => (
            <li key={s.id} className="delegation-row">
              <header className="delegation-row-head">
                <span className="delegation-provider">{s.provider}</span>
                <span className="delegation-time muted">{s.createdAt.slice(11, 19)}</span>
              </header>
              <div className="delegation-intent" title={s.intent}>{s.intent}</div>
              {s.notes?.length ? (
                <div className="delegation-notes muted">{s.notes[s.notes.length - 1]}</div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
