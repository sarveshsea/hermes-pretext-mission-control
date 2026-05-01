import type { SessionRow } from "../../api";

export default function SessionsPanel({ sessions }: { sessions: SessionRow[] }) {
  if (!sessions?.length) return <div className="muted">no active sessions</div>;
  return (
    <ul className="row-list">
      {sessions.slice(0, 8).map((s) => (
        <li key={s.key} className="row">
          <span className="row-time">{(s.updatedAt || "").slice(11, 19) || "—"}</span>
          <span className="row-tag">{s.platform}</span>
          <span className="row-id">{s.chatId || "?"}</span>
          <span className="row-content truncate">{s.userName || "anon"}</span>
        </li>
      ))}
    </ul>
  );
}
