// Loads JSON playbook recipes from ~/.hermes/playbooks/. The pipeline worker
// picks one of these to seed an edit-proposal so the model is just filling in
// blanks rather than imagining a shell pipeline from scratch.

import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";

const PLAYBOOK_DIR = path.join(ROOTS.hermes, "playbooks");
const CACHE_TTL_MS = 30_000;

let cache = null;
let cachedAt = 0;

async function loadAll() {
  const now = Date.now();
  if (cache && now - cachedAt < CACHE_TTL_MS) return cache;
  try {
    const entries = await fs.readdir(PLAYBOOK_DIR);
    const out = [];
    for (const name of entries) {
      if (!name.endsWith(".json")) continue;
      try {
        const text = await fs.readFile(path.join(PLAYBOOK_DIR, name), "utf8");
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object" && parsed.id) out.push(parsed);
      } catch {
        // skip bad json
      }
    }
    cache = out;
    cachedAt = now;
  } catch {
    cache = [];
    cachedAt = now;
  }
  return cache;
}

export async function listPlaybooks() {
  return loadAll();
}

export async function getPlaybook(id) {
  const all = await loadAll();
  return all.find((p) => p.id === id) || null;
}

export function _resetPlaybookCache() {
  cache = null;
  cachedAt = 0;
}
