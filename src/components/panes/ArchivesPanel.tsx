import { useState } from "react";
import type { ReactNode } from "react";

type Tab = {
  id: string;
  label: string;
  count?: number;
  body: ReactNode;
};

type Props = {
  tabs: Tab[];
  defaultId?: string;
};

// Single tabbed pane that consolidates the 8 tier-3 archive panes (sessions /
// skills / memfiles / git / publish / improve / runlog / local / changelog).
// Was: 8 dim panes always rendered, eye doesn't know where to land. Now: one
// pane, tab strip on top, body switches. Cuts visible cell count from ~25 to
// ~17, drastically cleaner.
export default function ArchivesPanel({ tabs, defaultId }: Props) {
  const [activeId, setActiveId] = useState<string>(defaultId || tabs[0]?.id || "");
  const active = tabs.find((t) => t.id === activeId) || tabs[0];

  return (
    <div className="archives-pane" data-testid="pane-archives">
      <div className="archives-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === activeId}
            className={`archives-tab ${t.id === activeId ? "archives-tab-active" : ""}`}
            onClick={() => setActiveId(t.id)}
          >
            <span className="archives-tab-label">{t.label}</span>
            {typeof t.count === "number" ? <span className="archives-tab-count">{t.count}</span> : null}
          </button>
        ))}
      </div>
      <div className="archives-body" role="tabpanel">
        {active?.body}
      </div>
    </div>
  );
}
