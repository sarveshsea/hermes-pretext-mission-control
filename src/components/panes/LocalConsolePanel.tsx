import type { LocalMessage } from "../../api";

export default function LocalConsolePanel({ messages }: { messages: LocalMessage[] }) {
  return (
    <div className="pane" id="pane-local">
      {/* Original content goes here */}
    </div>
  );
}
  if (!messages.length) return <div className="muted">no local messages</div>;
  return (
    <ul className="row-list">
      {messages.slice(0, 6).map((m) => (
        <li key={m.id} className="row">
          <span className="row-time">{(m.createdAt || "").slice(11, 19)}</span>
          <span className="row-tag ok">{m.author}</span>
          <span className="row-content truncate">{m.body}</span>
        </li>
      ))}
    </ul>
  );
}
