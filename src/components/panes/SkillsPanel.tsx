import type { SkillRow } from "../../api";

type Props = {
  skills: SkillRow[];
  activeCount: number;
  disabledCount: number;
  totalCount: number;
};

export default function SkillsPanel({ skills, activeCount, disabledCount, totalCount }: Props) {
  const active = skills.filter((s) => !s.disabled).slice(0, 8);
  return (
    <div className="kv">
      <div className="kv-row">
        <span className="kv-key">active</span>
        <span className="kv-val ok">{activeCount}</span>
        <span className="kv-key">disabled</span>
        <span className="kv-val muted">{disabledCount}</span>
        <span className="kv-key">total</span>
        <span className="kv-val">{totalCount}</span>
      </div>
      <ul className="row-list">
        {active.map((s) => (
          <li key={s.name} className="row">
            <span className="row-tag ok">·</span>
            <span className="row-id">{s.name}</span>
            <span className="row-content truncate muted">{s.description}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
