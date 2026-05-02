import { useEffect, useState } from "react";

type Entry = {
  sha: string;
  ts: string;
  subject: string;
  kind: "ui" | "agent" | "infra" | "other";
  filesTouched: number;
  sampleFile: string | null;
};

type Counts = { ui: number; agent: number; infra: number; other: number };

type Log = {
  windowMinutes: number;
  counts: Counts;
  entries: Entry[];
};

const KIND_LABEL: Record<Entry["kind"], string> = {
  ui: "UI",
  agent: "AGENT",
  infra: "INFRA",
  other: "OTHER"
};

// Direct, glanceable proof Hermes is improving the dashboard. Reads real
// commits (filtered to drop the auto-publish noise), classifies them as
// UI / agent / infra / other, and shows the last 24h. The headline counts
// answer "is the agent shipping UI improvements?" at a glance.
export default function ImprovementsLogPanel() {
  const [log, setLog] = useState<Log | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/hermes/improvements-log?minutes=1440", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setLog(data);
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

  if (!log) return <div className="muted">probing improvements…</div>;
  if (log.entries.length === 0) {
    return <div className="muted">no real commits in last 24h · auto-publish noise filtered out</div>;
  }

  return (
    <div className="improvements-log" data-testid="pane-improvements-log">
      <div className="impl-counts">
        <span className={`impl-count ${log.counts.ui ? "impl-on" : ""}`} title="UI / dashboard / styles commits">
          UI <strong>{log.counts.ui}</strong>
        </span>
        <span className={`impl-count ${log.counts.agent ? "impl-on" : ""}`} title="agent / pipeline / worker commits">
          AGENT <strong>{log.counts.agent}</strong>
        </span>
        <span className={`impl-count ${log.counts.infra ? "impl-on" : ""}`} title="server infra / config commits">
          INFRA <strong>{log.counts.infra}</strong>
        </span>
        <span className="impl-window muted">last 24h</span>
      </div>
      <ul className="impl-list">
        {log.entries.slice(0, 12).map((e) => (
          <li key={e.sha} className={`impl-row impl-kind-${e.kind}`}>
            <span className="impl-sha">{e.sha}</span>
            <span className="impl-kind-tag">{KIND_LABEL[e.kind]}</span>
            <span className="impl-subject" title={e.sampleFile || ""}>{e.subject}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
