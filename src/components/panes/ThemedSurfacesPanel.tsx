import type { ThemedSummary } from "../../api";

type Props = { themed: ThemedSummary };

const SURFACES: { key: keyof ThemedSummary; label: string; tone: string; hint: string }[] = [
  { key: "design_lab", label: "DESIGN_LAB", tone: "purple", hint: "design experiments" },
  { key: "sports_radar", label: "SPORTS_RADAR", tone: "blue", hint: "leagues / headlines / commentators" },
  { key: "buzzr_drafts", label: "BUZZR_DRAFTS", tone: "chartreuse", hint: "tweet drafts (gated)" },
  { key: "design_library", label: "DESIGN_LIBRARY", tone: "mint", hint: "system summaries" }
];

function getItemTitle(item: Record<string, unknown>): string {
  return (
    (item.title as string | undefined) ||
    (item.headline as string | undefined) ||
    (item.text as string | undefined) ||
    (item.summary as string | undefined) ||
    ""
  );
}

export default function ThemedSurfacesPanel({ themed }: Props) {
  return (
    <div className="themed-grid">
      {SURFACES.map((s) => {
        const summary = themed?.[s.key];
        const count = summary?.count ?? 0;
        const items = summary?.latest ?? [];
        return (
          <section key={s.key} className={`themed-cell themed-${s.tone}`}>
            <header>
              <strong>{s.label}</strong>
              <span className="muted">{count}</span>
            </header>
            {items.length === 0 ? (
              <p className="muted">{s.hint}</p>
            ) : (
              <ul>
                {items.slice(0, 4).map((item, idx) => {
                  const title = getItemTitle(item as unknown as Record<string, unknown>);
                  return (
                    <li key={idx} className="truncate">
                      · {title}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
