import type { ChangelogEntry } from "../../api";

export default function ChangelogPanel({ entries }: { entries: ChangelogEntry[] }) {
  if (!entries.length) return <div className="muted">no changelog yet</div>;
  return (
    <ul className="row-list">
      {entries.slice(0, 6).map((e, i) => (
        <li key={`${e.date}-${i}`} className="row">
          <span className="row-time">{e.date}</span>
          <span className="row-content truncate">{e.title}</span>
        </li>
      ))}
    </ul>
  );
}
