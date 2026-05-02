import { useEffect, useMemo, useRef, useState } from "react";

type CommandKind = "action" | "task" | "proposal" | "event";

type Command = {
  id: string;
  kind: CommandKind;
  label: string;
  hint?: string;
  run: () => void | Promise<void>;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

async function postAction(path: string, body?: Record<string, unknown>): Promise<string> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) return `failed (${res.status})`;
    const data = await res.json().catch(() => ({}));
    return (data?.lastResult || data?.status || data?.created || "ok").toString();
  } catch (e) {
    return e instanceof Error ? e.message : "failed";
  }
}

function setTheme(next: "light" | "dark" | null) {
  if (next === null) {
    document.documentElement.removeAttribute("data-theme");
    localStorage.removeItem("pretext-theme");
  } else {
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("pretext-theme", next);
  }
}

const ACTION_COMMANDS: Command[] = [
  {
    id: "fire-digest",
    kind: "action",
    label: "Fire Telegram digest now",
    hint: "/api/hermes/digest/fire",
    run: async () => { const msg = await postAction("/api/hermes/digest/fire"); console.info("digest:", msg); }
  },
  {
    id: "fire-claude",
    kind: "action",
    label: "Fire one Claude Code dispatch",
    hint: "/api/hermes/claude-agent/fire",
    run: async () => { const msg = await postAction("/api/hermes/claude-agent/fire"); console.info("claude-agent:", msg); }
  },
  {
    id: "seed-dogfood",
    kind: "action",
    label: "Seed dogfood tasks",
    hint: "+ N edit-shaped tasks for the pipeline",
    run: async () => { const msg = await postAction("/api/hermes/maintenance/seed-dogfood"); console.info("seed:", msg); }
  },
  {
    id: "seed-plans",
    kind: "action",
    label: "Seed multi-step plans",
    hint: "5 plans for the harness loop",
    run: async () => { const msg = await postAction("/api/hermes/maintenance/seed-plans"); console.info("plans:", msg); }
  },
  {
    id: "drain-recursion",
    kind: "action",
    label: "Drain task-recursion clusters",
    hint: "abandons all but oldest in each ≥5 cluster",
    run: async () => { const msg = await postAction("/api/hermes/maintenance/drain-recursion"); console.info("drain:", msg); }
  },
  {
    id: "concretize",
    kind: "action",
    label: "Concretize abstract tasks (batch)",
    hint: "map abstract titles → file_path via gpt-oss",
    run: async () => { const msg = await postAction("/api/hermes/maintenance/concretize-ledger"); console.info("concretize:", msg); }
  },
  {
    id: "reset-cadence",
    kind: "action",
    label: "Reset pipeline cadence",
    hint: "back to baseline interval",
    run: async () => { const msg = await postAction("/api/hermes/pipeline/cadence/reset"); console.info("cadence:", msg); }
  },
  {
    id: "theme-light",
    kind: "action",
    label: "Theme: Light",
    run: () => setTheme("light")
  },
  {
    id: "theme-dark",
    kind: "action",
    label: "Theme: Dark",
    run: () => setTheme("dark")
  },
  {
    id: "theme-system",
    kind: "action",
    label: "Theme: Follow system",
    run: () => setTheme(null)
  },
  {
    id: "focus-toggle",
    kind: "action",
    label: "Toggle focus mode (hide tier-3 panes)",
    hint: "F",
    run: () => {
      const cur = document.documentElement.getAttribute("data-focus");
      document.documentElement.setAttribute("data-focus", cur === "on" ? "off" : "on");
    }
  }
];

export default function CommandPalette({ open, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [searchHits, setSearchHits] = useState<Command[]>([]);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Live search across tasks + events when query is ≥3 chars
  useEffect(() => {
    if (!open || query.trim().length < 3) {
      setSearchHits([]);
      return;
    }
    let cancelled = false;
    const q = query.toLowerCase();
    const tick = async () => {
      try {
        const [tasks, events] = await Promise.all([
          fetch("/api/hermes/tasks?status=open", { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
          fetch("/api/hermes/events?limit=200", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { events: [] }))
        ]);
        if (cancelled) return;
        const taskHits: Command[] = (Array.isArray(tasks) ? tasks : tasks?.tasks || [])
          .filter((t: { title?: string }) => (t.title || "").toLowerCase().includes(q))
          .slice(0, 6)
          .map((t: { id: string; title: string; mission?: string }) => ({
            id: `task-${t.id}`,
            kind: "task" as const,
            label: t.title,
            hint: `[${t.mission || "general"}] ${t.id}`,
            run: () => {
              navigator.clipboard?.writeText(t.id);
              console.info("copied task id:", t.id);
            }
          }));
        const eventList = events?.events || events || [];
        const eventHits: Command[] = (Array.isArray(eventList) ? eventList : [])
          .filter((e: { content?: string }) => (e.content || "").toLowerCase().includes(q))
          .slice(0, 6)
          .map((e: { id: string; type: string; content: string; createdAt: string }) => ({
            id: `event-${e.id}`,
            kind: "event" as const,
            label: (e.content || "").slice(0, 90),
            hint: `${e.type} · ${e.createdAt.slice(11, 19)}`,
            run: () => {
              navigator.clipboard?.writeText(e.id);
              console.info("copied event id:", e.id);
            }
          }));
        setSearchHits([...taskHits, ...eventHits]);
      } catch {
        // best-effort
      }
    };
    void tick();
    return () => { cancelled = true; };
  }, [open, query]);

  const filteredActions = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return ACTION_COMMANDS;
    return ACTION_COMMANDS.filter((c) =>
      c.label.toLowerCase().includes(q) || (c.hint || "").toLowerCase().includes(q)
    );
  }, [query]);

  const allCommands = useMemo(() => [...filteredActions, ...searchHits], [filteredActions, searchHits]);

  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, allCommands.length - 1)));
  }, [allCommands.length]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected((s) => Math.min(allCommands.length - 1, s + 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelected((s) => Math.max(0, s - 1)); }
    if (e.key === "Enter") {
      e.preventDefault();
      const cmd = allCommands[selected];
      if (cmd) {
        void cmd.run();
        onClose();
      }
    }
  };

  return (
    <div className="cmdk-overlay" onClick={onClose} role="dialog" aria-label="Command palette">
      <div className="cmdk-card" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder="Type a command, search tasks, events…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
          onKeyDown={onKeyDown}
        />
        <ul className="cmdk-list">
          {allCommands.length === 0 ? (
            <li className="cmdk-empty muted">no matches</li>
          ) : (
            allCommands.map((c, i) => (
              <li
                key={c.id}
                className={`cmdk-row cmdk-${c.kind} ${i === selected ? "cmdk-selected" : ""}`}
                onMouseEnter={() => setSelected(i)}
                onClick={() => { void c.run(); onClose(); }}
              >
                <span className="cmdk-kind">{c.kind}</span>
                <span className="cmdk-label">{c.label}</span>
                {c.hint ? <span className="cmdk-hint muted">{c.hint}</span> : null}
              </li>
            ))
          )}
        </ul>
        <div className="cmdk-footer muted">↑↓ navigate · Enter run · Esc close · ⌘K toggle</div>
      </div>
    </div>
  );
}
