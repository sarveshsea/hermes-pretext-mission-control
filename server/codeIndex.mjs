// Codebase identifier index. Walks src/ + server/ and extracts:
//   - file paths
//   - exported symbols (functions, consts, defaults)
//   - React component file names
//   - CSS class names from styles.css
//   - bento pane keys from CELLS in App.tsx
//
// The pipeline worker's searchPhase prompt prepends a sample of these so the
// model picks REAL strings to grep for instead of imagining identifiers like
// "OpenTasksList|ProgressBar" that don't exist anywhere in the tree.

import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";

const SCAN_DIRS = ["src", "server"];
const SCAN_EXT = new Set([".tsx", ".ts", ".mjs", ".css"]);
const REFRESH_MS = 5 * 60_000;
const SNAPSHOT_PATH = path.join(ROOTS.project, "data/code-index.json");

let timer = null;
let cache = null;
let lastBuiltAt = null;
let lastBuildMs = 0;

async function walk(dir, out) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === "data") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, out);
    } else if (SCAN_EXT.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
}

const EXPORT_RE = /^export\s+(?:default\s+(?:function|class)\s+|async\s+function\s+|function\s+|const\s+|class\s+|let\s+)([A-Za-z_$][A-Za-z0-9_$]*)/gm;
const COMPONENT_RE = /^(?:export\s+)?(?:default\s+)?function\s+([A-Z][A-Za-z0-9_$]+)\s*\(/gm;
const CSS_CLASS_RE = /\.([a-zA-Z_-][a-zA-Z0-9_-]+)\s*[{,:]/g;
const CELLS_KEY_RE = /^\s*([a-zA-Z][a-zA-Z0-9]*)\s*:\s*\{\s*area\s*:/gm;

async function buildIndex() {
  const started = Date.now();
  const filePaths = [];
  for (const dir of SCAN_DIRS) {
    await walk(path.join(ROOTS.project, dir), filePaths);
  }
  const symbols = new Set();
  const components = new Set();
  const cssClasses = new Set();
  const paneKeys = new Set();
  const fileBasenames = new Set();

  for (const file of filePaths) {
    const rel = path.relative(ROOTS.project, file);
    fileBasenames.add(path.basename(file, path.extname(file)));
    let text;
    try {
      text = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    if (text.length > 400_000) continue;

    if (file.endsWith(".css")) {
      let m;
      while ((m = CSS_CLASS_RE.exec(text)) !== null) {
        if (m[1].length >= 3 && m[1].length <= 60) cssClasses.add(m[1]);
      }
      continue;
    }

    let m;
    EXPORT_RE.lastIndex = 0;
    while ((m = EXPORT_RE.exec(text)) !== null) symbols.add(m[1]);
    COMPONENT_RE.lastIndex = 0;
    while ((m = COMPONENT_RE.exec(text)) !== null) components.add(m[1]);
    if (file.endsWith("App.tsx") || file.endsWith("/App.tsx")) {
      CELLS_KEY_RE.lastIndex = 0;
      while ((m = CELLS_KEY_RE.exec(text)) !== null) paneKeys.add(m[1]);
    }
  }

  const idx = {
    generatedAt: new Date().toISOString(),
    counts: {
      files: filePaths.length,
      symbols: symbols.size,
      components: components.size,
      cssClasses: cssClasses.size,
      paneKeys: paneKeys.size
    },
    files: filePaths.map((f) => path.relative(ROOTS.project, f)).sort(),
    symbols: Array.from(symbols).sort(),
    components: Array.from(components).sort(),
    cssClasses: Array.from(cssClasses).sort(),
    paneKeys: Array.from(paneKeys).sort(),
    fileBasenames: Array.from(fileBasenames).sort()
  };
  cache = idx;
  lastBuiltAt = idx.generatedAt;
  lastBuildMs = Date.now() - started;
  try {
    await fs.mkdir(path.dirname(SNAPSHOT_PATH), { recursive: true });
    await fs.writeFile(SNAPSHOT_PATH, JSON.stringify(idx, null, 2), "utf8");
  } catch {
    // best-effort
  }
  return idx;
}

async function loadSnapshot() {
  try {
    const text = await fs.readFile(SNAPSHOT_PATH, "utf8");
    cache = JSON.parse(text);
    lastBuiltAt = cache.generatedAt || null;
  } catch {
    cache = null;
  }
}

export async function getCodeIndex() {
  if (cache) return cache;
  await loadSnapshot();
  if (cache) return cache;
  return buildIndex();
}

// Render a compact prompt block listing N rotating identifiers. Used by the
// pipeline worker's searchPhase + concretizePhase to ground the model.
export function renderIndexBlock(idx, { max = 80, mission = null } = {}) {
  if (!idx) return "(no index loaded)";
  const lines = [];
  // Always include all paneKeys + components — these are short and high-signal.
  const must = [
    ...idx.paneKeys.map((k) => `pane:${k}`),
    ...idx.components.slice(0, 30).map((c) => `<${c}>`)
  ];
  // Plus a rotating slice of files and symbols.
  const offset = Math.floor(Date.now() / 60_000) % Math.max(1, idx.files.length);
  const filesSlice = idx.files
    .slice(offset, offset + 12)
    .concat(idx.files.slice(0, Math.max(0, 12 - (idx.files.length - offset))));
  const symbolsSlice = idx.symbols.slice((offset * 3) % idx.symbols.length, ((offset * 3) % idx.symbols.length) + 12);
  const cssSlice = idx.cssClasses.slice((offset * 2) % idx.cssClasses.length, ((offset * 2) % idx.cssClasses.length) + 8);

  lines.push("REAL CODEBASE IDENTIFIERS (search/edit only these):");
  lines.push(`Files: ${[...new Set(filesSlice)].join(", ")}`);
  lines.push(`Components: ${idx.components.slice(0, 30).join(", ")}`);
  if (idx.paneKeys.length) lines.push(`Pane keys: ${idx.paneKeys.join(", ")}`);
  if (cssSlice.length) lines.push(`CSS classes: ${cssSlice.join(", ")}`);
  if (symbolsSlice.length) lines.push(`Exported symbols: ${symbolsSlice.join(", ")}`);
  // Soft cap.
  return lines.join("\n").slice(0, 1800);
}

export function startCodeIndex() {
  if (timer) return timer;
  void buildIndex();
  timer = setInterval(() => void buildIndex(), REFRESH_MS);
  timer.unref?.();
  return timer;
}

export function getCodeIndexStatus() {
  return {
    state: timer ? "running" : "stopped",
    intervalMs: REFRESH_MS,
    lastBuiltAt,
    lastBuildMs,
    counts: cache?.counts || null
  };
}
