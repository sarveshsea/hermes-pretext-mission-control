import { promises as fs, watch as fsWatch } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { isExcludedPath, safeSnippet } from "./redaction.mjs";
import { appendHermesEvent } from "./hermesEvents.mjs";

const VAULT_TTL_MS = 30_000;
const GRAPH_TTL_MS = 60_000;
const SAFE_WRITE_PREFIX = path.join(ROOTS.agent);
const RESERVED_PATTERNS = [
  /\/Daily Digest\.md$/,
  /\/Inbox\.md$/,
  /\/Career\.md$/,
  /\/GitHub\.md$/
];

let vaultCache = { value: null, at: 0 };
let graphCache = { value: null, at: 0 };
let watcherStarted = false;

function withinAgent(p) {
  const resolved = path.resolve(p);
  return resolved.startsWith(SAFE_WRITE_PREFIX + path.sep) || resolved === SAFE_WRITE_PREFIX;
}

function isReserved(p) {
  return RESERVED_PATTERNS.some((re) => re.test(p));
}

async function statSafe(p) {
  try {
    return await fs.stat(p);
  } catch {
    return null;
  }
}

function parseFront(text) {
  if (!text.startsWith("---")) return { front: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { front: {}, body: text };
  const block = text.slice(3, end).trim();
  const front = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (m) front[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return { front, body: text.slice(end + 4).replace(/^\s*\n/, "") };
}

function extractLinks(body) {
  const wiki = [...body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)].map((m) => m[1].trim());
  const tags = [...body.matchAll(/(?:^|\s)#([a-zA-Z0-9_/-]+)/g)].map((m) => m[1]);
  return { wikiLinks: Array.from(new Set(wiki)), tags: Array.from(new Set(tags)) };
}

async function walkRecursive(dir, depth, accumulator) {
  if (depth < 0) return;
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (isExcludedPath(full)) continue;
    if (entry.isDirectory()) {
      await walkRecursive(full, depth - 1, accumulator);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      accumulator.push(full);
    }
  }
}

export async function walkVault({ root = ROOTS.agent, depth = 4, force = false } = {}) {
  const now = Date.now();
  if (!force && vaultCache.value && now - vaultCache.at < VAULT_TTL_MS) return vaultCache.value;
  const files = [];
  await walkRecursive(root, depth, files);
  const notes = [];
  for (const file of files.slice(0, 600)) {
    const stat = await statSafe(file);
    if (!stat) continue;
    let text = "";
    try {
      text = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    const { front, body } = parseFront(text);
    const titleMatch = body.match(/^#\s+(.+?)\s*$/m);
    const title = front.title || (titleMatch ? titleMatch[1] : path.basename(file, ".md"));
    const { wikiLinks, tags } = extractLinks(body);
    notes.push({
      path: file.replace(SAFE_WRITE_PREFIX, "Agent"),
      absolutePath: file,
      title: safeSnippet(title, 200),
      tags,
      wikiLinks,
      bytes: stat.size,
      mtime: stat.mtime.toISOString(),
      front
    });
  }
  notes.sort((a, b) => b.mtime.localeCompare(a.mtime));
  const value = {
    generatedAt: new Date().toISOString(),
    root: root.replace("/Users/sarveshchidambaram", "~"),
    count: notes.length,
    notes
  };
  vaultCache = { value, at: now };
  return value;
}

export async function readNote(relPath) {
  if (!relPath || typeof relPath !== "string") {
    const error = new Error("path required");
    error.status = 400;
    throw error;
  }
  const abs = relPath.startsWith("/") ? relPath : path.join(ROOTS.vault, relPath);
  if (!withinAgent(abs)) {
    const error = new Error("Refusing to read outside Agent/");
    error.status = 403;
    throw error;
  }
  const text = await fs.readFile(abs, "utf8");
  const stat = await statSafe(abs);
  const { front, body } = parseFront(text);
  return {
    path: abs.replace(SAFE_WRITE_PREFIX, "Agent"),
    bytes: stat?.size ?? text.length,
    mtime: stat?.mtime?.toISOString() ?? null,
    front,
    body
  };
}

export async function writeNote({ path: relPath, body, frontmatter }) {
  if (!relPath || typeof relPath !== "string" || typeof body !== "string") {
    const error = new Error("path and body required");
    error.status = 400;
    throw error;
  }
  const abs = relPath.startsWith("/")
    ? relPath
    : relPath.startsWith("Agent/")
      ? path.join(ROOTS.vault, relPath)
      : path.join(SAFE_WRITE_PREFIX, relPath);
  if (!withinAgent(abs)) {
    const error = new Error("Refusing to write outside Agent/");
    error.status = 403;
    throw error;
  }
  if (isReserved(abs)) {
    const error = new Error("Refusing to write reserved index file");
    error.status = 403;
    throw error;
  }
  await fs.mkdir(path.dirname(abs), { recursive: true });
  let payload = body;
  if (frontmatter && typeof frontmatter === "object") {
    const fm = Object.entries(frontmatter)
      .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
      .join("\n");
    payload = `---\n${fm}\n---\n\n${body.replace(/^\n+/, "")}`;
  }
  await fs.writeFile(abs, payload, "utf8");
  const stat = await statSafe(abs);
  vaultCache = { value: null, at: 0 };
  graphCache = { value: null, at: 0 };
  await appendHermesEvent({
    type: "memory_write",
    role: "assistant",
    content: `${abs.replace(SAFE_WRITE_PREFIX, "Agent")}: ${safeSnippet(body, 160)}`
  });
  return {
    path: abs.replace(SAFE_WRITE_PREFIX, "Agent"),
    mtime: stat?.mtime?.toISOString() ?? null,
    bytes: stat?.size ?? payload.length
  };
}

export async function linkGraph({ depth = 4, force = false } = {}) {
  const now = Date.now();
  if (!force && graphCache.value && now - graphCache.at < GRAPH_TTL_MS) return graphCache.value;
  const vault = await walkVault({ depth, force });
  const titleIndex = new Map();
  vault.notes.forEach((note) => titleIndex.set(note.title.toLowerCase(), note.path));
  const nodes = vault.notes.map((note) => ({
    id: note.path,
    title: note.title,
    tags: note.tags
  }));
  const edges = [];
  for (const note of vault.notes) {
    for (const link of note.wikiLinks) {
      const target = titleIndex.get(link.toLowerCase());
      if (target) edges.push({ from: note.path, to: target, kind: "wiki" });
    }
  }
  const value = {
    generatedAt: new Date().toISOString(),
    nodes,
    edges,
    nodeCount: nodes.length,
    edgeCount: edges.length
  };
  graphCache = { value, at: now };
  return value;
}

export function startObsidianWatcher() {
  if (watcherStarted) return;
  watcherStarted = true;
  try {
    fsWatch(ROOTS.agent, { recursive: true }, (eventType, filename) => {
      if (!filename || !filename.endsWith(".md")) return;
      vaultCache = { value: null, at: 0 };
      graphCache = { value: null, at: 0 };
      void appendHermesEvent({
        type: "memory_write",
        role: "system",
        content: `vault ${eventType}: ${filename}`
      });
    });
  } catch {
    // some macOS/Linux combinations don't support recursive watch; skip silently
  }
}
