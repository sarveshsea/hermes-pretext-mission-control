import type { HermesEvent, MissionState } from "../../api";
import { colorFor } from "../../visualEngine";

type Props = { mission: MissionState; events: HermesEvent[] };

export default function MemoryPanel({ mission, events }: Props) {
  const items = mission?.memory?.length
    ? mission.memory
    : events.filter((e) => e.type === "memory_read" || e.type === "memory_write" || e.type === "note").slice(0, 8);
  if (!items.length) {
    return (
      <div className="muted">
        no memory writes yet · expected: ~/Documents/Obsidian/Sarvesh Brain/Agent/Hermes Logs/
      </div>
    );
  }
  return (
    <ul className="row-list">
      {items.slice(0, 8).map((e) => (
        <li key={e.id} className="row" style={{ color: colorFor(e.type) }}>
          <span className="row-time">{(e.createdAt || "").slice(11, 19)}</span>
          <span className="row-tag">{e.type.toUpperCase()}</span>
          <span className="row-content truncate">{(e.content || "").replace(/\s+/g, " ")}</span>
        </li>
      ))}
    </ul>
  );
}
