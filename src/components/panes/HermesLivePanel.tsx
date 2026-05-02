import type { HermesEvent } from "../../api";
import { colorFor } from "../../visualEngine";

type Props = {
  events: HermesEvent[];
  onSelect?: (event: HermesEvent) => void;
};

function timeLabel(iso: string): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "now";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 5) return `${min}m ago`;
  return iso.slice(11, 19);
}

export default function HermesLivePanel({ events, onSelect }: Props) {
  if (!events.length) return <div className="muted">waiting for events…</div>;
  return (
    <ul className="row-list event-list">
      {events.slice(0, 12).map((e) => (
        <li
          key={e.id}
          className="row event-row"
          style={{ color: colorFor(e.type) }}
          onClick={() => onSelect?.(e)}
          title={e.createdAt}
        >
          <span className="row-time">{timeLabel(e.createdAt || "")}</span>
          <span className="row-tag">{e.type.toUpperCase()}</span>
          <span className="row-id">{e.role || ""}</span>
          <span className="row-content truncate">{(e.content || "").replace(/\s+/g, " ")}</span>
        </li>
      ))}
    </ul>
  );
}
