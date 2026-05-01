import type { RunRequest } from "../../api";

function clip(s: string | undefined, n: number) {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export default function RunLogPanel({ runs }: { runs: RunRequest[] }) {
  if (!runs.length) return <div className="muted">EMPTY</div>;
  return (
    <ul className="row-list">
      {runs.slice(0, 8).map((r) => {
        const tone = r.status === "completed" ? "ok" : r.status === "failed" ? "warn" : "muted";
        return (
          <li key={r.id} className="row">
            <span className={`row-tag ${tone}`}>{r.status.toUpperCase().slice(0, 8)}</span>
            <span className="row-content truncate">{clip(r.command, 60)}</span>
            {Number.isFinite(r.durationMs) ? <span className="row-time muted">{r.durationMs}ms</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
