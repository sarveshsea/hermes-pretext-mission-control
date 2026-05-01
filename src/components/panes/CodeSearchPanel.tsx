import { useEffect, useRef, useState } from "react";

type Match = { file: string; line: number; column: number; snippet: string };

export default function CodeSearchPanel() {
  const [pattern, setPattern] = useState("");
  const [scope, setScope] = useState<"project" | "hermes">("project");
  const [matches, setMatches] = useState<Match[]>([]);
  const [tool, setTool] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!pattern.trim()) {
      setMatches([]);
      return;
    }
    const handle = window.setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch("/api/code/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pattern, scope, maxResults: 60 })
        });
        const data = await res.json();
        setMatches(data.matches || []);
        setTool(data.tool || "");
        setActive(0);
      } catch {
        // ignore
      } finally {
        setBusy(false);
      }
    }, 300);
    return () => window.clearTimeout(handle);
  }, [pattern, scope]);

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || (e.key === "j" && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      setActive((a) => Math.min(matches.length - 1, a + 1));
    } else if (e.key === "ArrowUp" || (e.key === "k" && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && matches[active]) {
      void navigator.clipboard?.writeText(`${matches[active].file}:${matches[active].line}`);
    }
  }

  return (
    <div className="code-search">
      <div className="code-search-bar">
        <input
          ref={inputRef}
          className="code-search-input"
          placeholder="ripgrep pattern…"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          onKeyDown={onKey}
          data-pane-input="code-search"
        />
        <select
          className="code-search-scope"
          value={scope}
          onChange={(e) => setScope(e.target.value as "project" | "hermes")}
        >
          <option value="project">project</option>
          <option value="hermes">hermes</option>
        </select>
        <span className="muted">
          {busy ? "…" : `${matches.length}${tool ? ` · ${tool}` : ""}`}
        </span>
      </div>
      <ul className="code-search-results">
        {matches.slice(0, 40).map((m, idx) => (
          <li
            key={`${m.file}-${m.line}-${idx}`}
            className={`row ${idx === active ? "row-active" : ""}`}
            onClick={() => {
              setActive(idx);
              void navigator.clipboard?.writeText(`${m.file}:${m.line}`);
            }}
          >
            <span className="row-id">{m.file}:{m.line}</span>
            <span className="row-content truncate muted">{m.snippet}</span>
          </li>
        ))}
        {matches.length === 0 && pattern && !busy && <li className="muted">no matches</li>}
        {!pattern && <li className="muted">type to search code</li>}
      </ul>
    </div>
  );
}
