import type { SubscriptionTask } from "../../api";

export default function SubscriptionLedgerPanel({ tasks }: { tasks: SubscriptionTask[] }) {
  if (!tasks?.length) {
    return <div className="muted">no subscription tasks · Hermes can dispatch to Codex / Claude Max</div>;
  }
  const open = tasks.filter((t) => t.status !== "completed" && t.status !== "abandoned");
  const closed = tasks.filter((t) => t.status === "completed" || t.status === "abandoned");
  return (
    <div className="kv">
      <div className="kv-row">
        <span className="kv-key">open</span>
        <span className="kv-val">{open.length}</span>
        <span className="kv-key">closed</span>
        <span className="kv-val muted">{closed.length}</span>
      </div>
      <ul className="row-list">
        {tasks.slice(0, 10).map((t) => {
          const tone = t.status === "completed" ? "ok" : t.status === "failed" ? "warn" : "muted";
          return (
            <li key={t.id} className="row" title={t.intent}>
              <span className={`row-tag ${tone}`}>{t.provider}</span>
              <span className="row-id">{t.status}</span>
              <span className="row-content truncate">{t.intent}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
