export const LAYOUT_VERSION = 1;

export type PanePosition = { x: number; y: number; w?: number; h?: number; z?: number };
export type LayoutMap = Record<string, PanePosition>;

export type LayoutSnapshot = {
  version: number;
  panes: LayoutMap;
  nodes: LayoutMap;
  obsidianNodes: LayoutMap;
  updatedAt: string | null;
};

export const SNAP_PX = 8;

export function snap(value: number): number {
  return Math.round(value / SNAP_PX) * SNAP_PX;
}

// Default pane positions for the 18 surfaces. Tuned for a 1440x900 viewport.
// Order roughly: top status row, mid-left context stack, mid-right live stack,
// bottom utility cluster.
export const DEFAULT_PANE_POSITIONS: LayoutMap = {
  health: { x: 32, y: 76, w: 480, h: 96 },
  cadence: { x: 520, y: 76, w: 460, h: 96 },
  sparkline: { x: 988, y: 76, w: 380, h: 96 },

  "git-state": { x: 32, y: 184, w: 320, h: 100 },
  "github-publish": { x: 360, y: 184, w: 320, h: 100 },
  "improvement-loop": { x: 688, y: 184, w: 320, h: 100 },
  "performance": { x: 1016, y: 184, w: 352, h: 100 },

  sessions: { x: 32, y: 296, w: 320, h: 184 },
  skills: { x: 32, y: 488, w: 320, h: 184 },
  "memory-files": { x: 32, y: 680, w: 320, h: 160 },

  "hermes-live": { x: 1016, y: 296, w: 352, h: 184 },
  thinking: { x: 1016, y: 488, w: 352, h: 184 },
  mission: { x: 1016, y: 680, w: 352, h: 160 },
  memory: { x: 1016, y: 848, w: 352, h: 160 },

  "run-log": { x: 360, y: 612, w: 320, h: 144 },
  "local-console": { x: 688, y: 612, w: 320, h: 144 },
  changelog: { x: 360, y: 764, w: 320, h: 144 },

  "code-search": { x: 360, y: 296, w: 320, h: 308 },
  "subagent-tree": { x: 688, y: 296, w: 320, h: 308 },
  "themed-surfaces": { x: 32, y: 848, w: 976, h: 120 },

  "obsidian-graph": { x: 360, y: 916, w: 648, h: 240 }
};

// Default Hermes graph node positions (% of viewport width/height).
// Same as the previous consoleModel.ts hardcodes; kept here so it can be
// overridden per-user via the layout server endpoint.
export const DEFAULT_NODE_POSITIONS: LayoutMap = {
  hermes: { x: 50, y: 16 },
  builder: { x: 23, y: 34 },
  "run-queue": { x: 77, y: 34 },
  "local-console": { x: 50, y: 84 },
  obsidian: { x: 17, y: 70 },
  projects: { x: 50, y: 78 },
  "design-memory": { x: 83, y: 70 }
};

const STORAGE_KEY = "pretext.layout.v1";

export function loadCachedLayout(): LayoutSnapshot | null {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (!text) return null;
    const parsed = JSON.parse(text);
    if (parsed?.version !== LAYOUT_VERSION) return null;
    return parsed as LayoutSnapshot;
  } catch {
    return null;
  }
}

export function cacheLayout(snapshot: LayoutSnapshot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // localStorage full or disabled
  }
}

export async function fetchServerLayout(): Promise<LayoutSnapshot | null> {
  try {
    const res = await fetch("/api/dashboard-layout", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as LayoutSnapshot;
  } catch {
    return null;
  }
}

export async function persistServerLayout(patch: Partial<LayoutSnapshot>): Promise<void> {
  try {
    await fetch("/api/dashboard-layout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
  } catch {
    // best-effort
  }
}

export async function resetServerLayout(): Promise<void> {
  try {
    await fetch("/api/dashboard-layout", { method: "DELETE" });
  } catch {
    // best-effort
  }
}

export function mergeLayout(
  defaults: LayoutMap,
  ...overrides: (LayoutMap | undefined)[]
): LayoutMap {
  const out: LayoutMap = { ...defaults };
  for (const override of overrides) {
    if (!override) continue;
    for (const [key, value] of Object.entries(override)) {
      out[key] = { ...out[key], ...value };
    }
  }
  return out;
}
