import { useCallback, useEffect, useState } from "react";

type Counts = {
  events: number;
  tasksCreated: number;
  tasksClosed: number;
  proposalsTotal: number;
  proposalsByStatus: Record<string, number>;
  sportsHeadlines: number;
  buzzrDrafts: number;
  designLab: number;
  designLibrary: number;
  critiques: number;
  commits: number;
  errors: number;
  thinking: number;
};

type Report = {
  generatedAt: string;
  startedAt: string;
  minutes: number;
  counts: Counts;
  markdown: string;
};

const WINDOWS: { label: string; minutes: number }[] = [
  { label: "15m", minutes: 15 },
  { label: "60m", minutes: 60 },
  { label: "3h", minutes: 180 },
  { label: "12h", minutes: 720 }
];

export default function SessionReportPanel() {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [minutes, setMinutes] = useState(60);
  const [showMarkdown, setShowMarkdown] = useState(false);

  const fetchReport = useCallback(async (m: number) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/hermes/session-report?minutes=${m}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status}`);
      setReport((await res.json()) as Report);
    } catch {
      // best-effort
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void fetchReport(minutes);
  }, [minutes, fetchReport]);

  return (
    <div className="session-report">
      <div className="session-report-bar">
        <div className="session-windows">
          {WINDOWS.map((w) => (
            <button
              key={w.minutes}
              className={`button button-mini ${minutes === w.minutes ? "button-primary" : "button-light"}`}
              onClick={() => setMinutes(w.minutes)}
              disabled={busy}
            >
              {w.label}
            </button>
          ))}
          <button className="button button-mini button-light" onClick={() => fetchReport(minutes)} disabled={busy}>
            {busy ? "…" : "refresh"}
          </button>
          <button
            className="button button-mini button-light"
            onClick={() => setShowMarkdown((s) => !s)}
            disabled={busy || !report}
          >
            {showMarkdown ? "summary" : "markdown"}
          </button>
        </div>
      </div>
      {!report ? (
        <div className="muted">probing…</div>
      ) : showMarkdown ? (
        <pre className="session-report-md">{report.markdown}</pre>
      ) : (
        <div className="kv">
          <div className="kv-row">
            <span className="kv-key">window</span>
            <span className="kv-val">{report.minutes}m</span>
            <span className="kv-key">at</span>
            <span className="kv-val muted">{report.generatedAt.slice(11, 19)}</span>
          </div>
          <div className="kv-row">
            <span className="kv-key">events</span>
            <span className="kv-val">{report.counts.events}</span>
            <span className="kv-key">thinking</span>
            <span className="kv-val">{report.counts.thinking}</span>
            <span className="kv-key">errors</span>
            <span className={`kv-val ${report.counts.errors > 5 ? "warn" : "muted"}`}>{report.counts.errors}</span>
          </div>
          <div className="kv-row">
            <span className="kv-key">tasks +</span>
            <span className="kv-val">{report.counts.tasksCreated}</span>
            <span className="kv-key">done</span>
            <span className="kv-val">{report.counts.tasksClosed}</span>
            <span className="kv-key">commits</span>
            <span className="kv-val">{report.counts.commits}</span>
          </div>
          <div className="kv-row">
            <span className="kv-key">proposals</span>
            <span className="kv-val">{report.counts.proposalsTotal}</span>
            {Object.entries(report.counts.proposalsByStatus).map(([k, v]) => (
              <span key={k} className="kv-val">
                <em>{k}</em> {v}
              </span>
            ))}
          </div>
          <div className="kv-row">
            <span className="kv-key">sports</span>
            <span className="kv-val">{report.counts.sportsHeadlines}</span>
            <span className="kv-key">buzzr</span>
            <span className="kv-val">{report.counts.buzzrDrafts}</span>
            <span className="kv-key">design</span>
            <span className="kv-val">{report.counts.designLab}</span>
            <span className="kv-key">library</span>
            <span className="kv-val">{report.counts.designLibrary}</span>
          </div>
          <div className="kv-row">
            <span className="kv-key">critiques</span>
            <span className="kv-val">{report.counts.critiques}</span>
          </div>
          <div className="kv-row muted" style={{ marginTop: 6 }}>
            mirrored to <code>Agent/Hermes Logs/Sessions/</code>
          </div>
        </div>
      )}
    </div>
  );
}
