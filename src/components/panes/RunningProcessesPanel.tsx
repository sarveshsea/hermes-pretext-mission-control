import type { ProcessSummary } from "../../api";

function timeOnly(iso: string | null) {
  if (!iso) return "—";
  return iso.slice(11, 19);
}

export default function RunningProcessesPanel({ processes }: { processes: ProcessSummary }) {
  if (!processes) return <div className="muted">no processes</div>;
  return (
    <div className="proc-rail">
      <section className="proc-section">
        <header>LOOPS</header>
        <ul className="proc-list">
          {processes.processes.map((p) => (
            <li key={p.id} className={`proc-row ${p.state === "running" ? "ok" : p.state === "stopped" ? "muted" : "warn"}`}>
              <div className="proc-head">
                <span className="proc-dot" aria-hidden>●</span>
                <span className="proc-label">{p.label}</span>
                <span className="proc-state">{p.state}</span>
              </div>
              <div className="proc-detail muted">{p.detail}</div>
              <div className="proc-meta muted">
                <span>last {timeOnly(p.lastAt)}</span>
                {p.lastError ? <span className="warn">err: {p.lastError.slice(0, 50)}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="proc-section">
        <header>CRONS</header>
        <ul className="proc-list">
          {processes.crons.map((c) => (
            <li
              key={c.id}
              className={`proc-row ${c.lastStatus === "ok" ? "ok" : c.lastStatus === "error" ? "warn" : "muted"}`}
            >
              <div className="proc-head">
                <span className="proc-dot" aria-hidden>◆</span>
                <span className="proc-label">{c.id}</span>
                <span className="proc-state">{c.everyMinutes ? `${c.everyMinutes}m` : "?"}</span>
              </div>
              <div className="proc-detail muted">
                {c.completed} runs · model {c.model || "default"}
              </div>
              <div className="proc-meta muted">
                <span>last {timeOnly(c.lastRunAt)} {c.lastStatus || "—"}</span>
                <span>next {timeOnly(c.nextRunAt)}</span>
              </div>
              {c.lastError ? <div className="warn truncate">err: {c.lastError}</div> : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
