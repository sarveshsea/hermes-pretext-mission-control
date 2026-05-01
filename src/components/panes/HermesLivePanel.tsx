import type { HermesEvent } from "../../api";
import { colorFor } from "../../visualEngine";

type Props = {
  events: HermesEvent[];
  onSelect?: (event: HermesEvent) => void;
};

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
        >
          <span className="row-time">{(e.createdAt || "").slice(11, 19)}</span>
          <span className="row-tag">{e.type.toUpperCase()}</span>
          <span className="row-id">{e.role || ""}</span>
          <span className="row-content truncate">{(e.content || "").replace(/\s+/g, " ")}</span>
        </li>
      ))}
    </ul>
  );
}
