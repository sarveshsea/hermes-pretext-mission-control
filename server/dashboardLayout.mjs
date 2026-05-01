import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";

const STORE = path.join(ROOTS.project, "data/dashboard-layout.json");
const VERSION = 1;

let cache = null;

async function load() {
  if (cache) return cache;
  try {
    const text = await fs.readFile(STORE, "utf8");
    const parsed = JSON.parse(text);
    cache = {
      version: parsed.version || VERSION,
      panes: parsed.panes && typeof parsed.panes === "object" ? parsed.panes : {},
      nodes: parsed.nodes && typeof parsed.nodes === "object" ? parsed.nodes : {},
      obsidianNodes: parsed.obsidianNodes && typeof parsed.obsidianNodes === "object" ? parsed.obsidianNodes : {},
      updatedAt: parsed.updatedAt || null
    };
  } catch {
    cache = { version: VERSION, panes: {}, nodes: {}, obsidianNodes: {}, updatedAt: null };
  }
  return cache;
}

async function persist() {
  if (!cache) return;
  await fs.mkdir(path.dirname(STORE), { recursive: true });
  await fs.writeFile(STORE, JSON.stringify(cache, null, 2), "utf8");
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function sanitizePosition(value) {
  if (!value || typeof value !== "object") return null;
  const x = clamp(Number(value.x) || 0, -200, 4000);
  const y = clamp(Number(value.y) || 0, -200, 4000);
  const out = { x: Math.round(x), y: Math.round(y) };
  if (Number.isFinite(value.w)) out.w = clamp(Math.round(value.w), 80, 1200);
  if (Number.isFinite(value.h)) out.h = clamp(Math.round(value.h), 40, 800);
  if (Number.isFinite(value.z)) out.z = Math.round(value.z);
  return out;
}

function sanitizeMap(input) {
  if (!input || typeof input !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof key !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(key)) continue;
    const pos = sanitizePosition(value);
    if (pos) out[key] = pos;
  }
  return out;
}

export async function getLayout() {
  const data = await load();
  return { ...data };
}

export async function updateLayout(patch = {}) {
  await load();
  if (patch.panes) cache.panes = { ...cache.panes, ...sanitizeMap(patch.panes) };
  if (patch.nodes) cache.nodes = { ...cache.nodes, ...sanitizeMap(patch.nodes) };
  if (patch.obsidianNodes) {
    cache.obsidianNodes = { ...cache.obsidianNodes, ...sanitizeMap(patch.obsidianNodes) };
  }
  cache.updatedAt = new Date().toISOString();
  await persist();
  return { ...cache };
}

export async function resetLayout() {
  cache = { version: VERSION, panes: {}, nodes: {}, obsidianNodes: {}, updatedAt: new Date().toISOString() };
  await persist();
  return { ...cache };
}
