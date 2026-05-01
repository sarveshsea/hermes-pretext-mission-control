// Per-playbook success/failure tracking. Updated on every pipeline outcome.
// The playbook phase reads stats and biases selection toward proven recipes;
// new playbooks get a small guaranteed-trial budget so they're not starved.

import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";

const STATS_PATH = path.join(ROOTS.hermes, "playbooks/_stats.json");
const MAX_OUTCOMES = 12;

let cache = null;

async function load() {
  if (cache) return cache;
  try {
    const text = await fs.readFile(STATS_PATH, "utf8");
    const parsed = JSON.parse(text);
    cache = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    cache = {};
  }
  return cache;
}

async function persist() {
  if (!cache) return;
  try {
    await fs.mkdir(path.dirname(STATS_PATH), { recursive: true });
    await fs.writeFile(STATS_PATH, JSON.stringify(cache, null, 2), "utf8");
  } catch {
    // best-effort
  }
}

export async function recordOutcome(playbookId, { outcome, diffLines = 0, reason = "" } = {}) {
  if (!playbookId) return;
  await load();
  const rec = cache[playbookId] || { success: 0, fail: 0, totalDiffLines: 0, recentOutcomes: [] };
  if (outcome === "applied" || outcome === "shipped") {
    rec.success += 1;
    rec.totalDiffLines += Number(diffLines || 0);
    rec.recentOutcomes.push({ ts: new Date().toISOString(), result: "ship", diffLines });
  } else {
    rec.fail += 1;
    rec.recentOutcomes.push({ ts: new Date().toISOString(), result: "fail", reason: String(reason || "").slice(0, 120) });
  }
  rec.recentOutcomes = rec.recentOutcomes.slice(-MAX_OUTCOMES);
  rec.lastSeen = new Date().toISOString();
  cache[playbookId] = rec;
  await persist();
}

export async function readAllStats() {
  await load();
  return cache;
}

// For the playbook phase prompt: rank playbooks by (success - fail) but keep
// untested ones in the top-3 so they get tried. Returns array of {id, score, success, fail}.
export async function rankedPlaybooks(playbookIds) {
  await load();
  const scored = playbookIds.map((id) => {
    const rec = cache[id];
    if (!rec) return { id, score: 0.6, success: 0, fail: 0, untested: true }; // mid-rank — give a try
    const total = rec.success + rec.fail;
    const successRate = total === 0 ? 0.5 : rec.success / total;
    return { id, score: successRate, success: rec.success, fail: rec.fail, untested: false };
  });
  return scored.sort((a, b) => b.score - a.score);
}
