import type { MemoryFile } from "../../api";

export default function MemoryFilesPanel({ files, count }: { files: MemoryFile[]; count: number }) {
  return (
    <div className="kv">
      <div className="kv-row">
        <span className="kv-key">loaded</span>
        <span className="kv-val">{count}</span>
      </div>
      <ul className="row-list">
        {files.slice(0, 6).map((f) => (
          <li key={f.file} className="row" title={f.excerpt}>
            <span className="row-tag">·</span>
            <span className="row-id">{f.name}</span>
            <span className="row-content truncate muted">{f.description}</span>
          </li>
        ))}
        {files.length === 0 && <li className="muted">~/.hermes/memories empty</li>}
      </ul>
    </div>
  );
}
