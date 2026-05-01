// Shared world state injected into every swarm worker prompt so they can
// read each other's outputs within the same tick. Without this, the 11
// workers run in isolated bubbles — the critic shouts into the void, the
// planner regenerates the same plan 47 times, the executor tries the same
// rejected proposal patterns. Memo-cached for 30s so 11 workers calling
// within the same minute share one read.

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { getHermesEvents } from "./hermesEvents.mjs";
import { listTasks } from "./taskLedger.mjs";
import { getProposals } from "./proposals.mjs";
import { safeSnippet } from "./redaction.mjs";

const CACHE_TTL_MS = 30_000;
const LESSONS_PATH = path.join(ROOTS.hermes, "memories/recent_lessons.md");

let cache = null;
let cachedAt = 0;

function execGit(args) {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd: ROOTS.project, timeout: 4000, maxBuffer: 256 * 1024 },
      (error, stdout) => {
        resolve({ ok: !error, stdout: (stdout || "").toString().trim() });
      }
    );
  });
}

async function recentCommits(n = 3) {
  const log = await execGit(["log", `-${n}`, "--pretty=format:%h|%s|%an"]);
  if (!log.ok || !log.stdout) return [];
  const out = [];
  for (const line of log.stdout.split("\n").filter(Boolean)) {
    const [sha, subject, author] = line.split("|");
    const stat = await execGit(["show", "--stat", "--no-color", "--pretty=format:", sha]);
    const tail = (stat.stdout || "")
      .split("\n")
      .filter(Boolean)
      .slice(-1)[0] || "";
    out.push({ sha, subject, author, stat: safeSnippet(tail, 80) });
  }
  return out;
}

async function readLessons() {
  try {
    const text = await fs.readFile(LESSONS_PATH, "utf8");
    return safeSnippet(text, 800);
  } catch {
    return "";
  }
}

async function build() {
  const [events, openTasks, proposals, commits, lessons] = await Promise.all([
    getHermesEvents(120),
    listTasks({ status: "open" }),
    getProposals(40),
    recentCommits(3),
    readLessons()
  ]);
  const criticFlags = events
    .filter((e) => e.type === "mission_update" && /^\[critic/i.test(e.content || ""))
    .slice(0, 5)
    .map((e) => safeSnippet(e.content.replace(/^\[critic[^\]]*\]\s*/i, ""), 140));
  const recentRejections = proposals
    .filter((p) => p.status === "rejected")
    .slice(0, 5)
    .map((p) => `${safeSnippet(p.title, 60)} — ${safeSnippet(p.declineReason || "", 80)}`);
  const topTasks = openTasks
    .slice(0, 5)
    .map((t) => {
      const ageMin = Math.round((Date.now() - new Date(t.createdAt).getTime()) / 60_000);
      return `[${t.mission}] ${safeSnippet(t.title, 80)} (id=${t.id}, age=${ageMin}m)`;
    });
  return { topTasks, criticFlags, recentRejections, commits, lessons };
}

export async function getSharedContext() {
  const now = Date.now();
  if (cache && now - cachedAt < CACHE_TTL_MS) return cache;
  cache = await build();
  cachedAt = now;
  return cache;
}

// Render the shared context as a prompt prefix block. Trimmed so the full
// block stays under ~1200 chars — leaves room for per-worker instructions
// and recent events under the model's num_ctx (4096) budget.
export function formatSharedContextBlock(ctx) {
  const lines = ["=== SWARM SHARED STATE ==="];
  lines.push("Top open tasks (work on these, not new ones):");
  if (ctx.topTasks.length === 0) lines.push("  (none — propose a Tier 2 task)");
  else for (const t of ctx.topTasks) lines.push(`  - ${t}`);
  if (ctx.criticFlags.length) {
    lines.push("Recent critic flags (address these):");
    for (const f of ctx.criticFlags) lines.push(`  ! ${f}`);
  }
  if (ctx.recentRejections.length) {
    lines.push("Recently rejected proposals (do NOT repeat these patterns):");
    for (const r of ctx.recentRejections) lines.push(`  ✗ ${r}`);
  }
  if (ctx.commits.length) {
    lines.push("Last commits (build on these, don't redo):");
    for (const c of ctx.commits) lines.push(`  • ${c.sha} ${c.subject} _${c.stat}_`);
  }
  if (ctx.lessons) {
    lines.push("Recent lessons (cross-hour memory):");
    lines.push(ctx.lessons.split("\n").map((l) => `  ${l}`).join("\n"));
  }
  lines.push("=== END SHARED STATE ===");
  return lines.join("\n");
}

export function _resetSwarmContextCache() {
  cache = null;
  cachedAt = 0;
}
