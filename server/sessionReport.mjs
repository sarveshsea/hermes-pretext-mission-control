// Generates a full markdown digest of what the dashboard / swarm did during
// the last N minutes. Bundles events from the archive (so older windows are
// readable even after the ring buffer rolls), tasks created in the window,
// proposals + outcomes, themed surface adds, commits, errors.

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { readArchivedEvents } from "./eventArchive.mjs";
import { listTasks } from "./taskLedger.mjs";
import { getProposals } from "./proposals.mjs";
import { getThemedItems } from "./themedSurfaces.mjs";
import { getSwarmStatus } from "./workerSwarm.mjs";
import { listSubscriptionTasks } from "./subscriptions.mjs";
import { safeSnippet } from "./redaction.mjs";

const REPORTS_DIR = ROOTS.hermesOpsSessions;

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

async function commitsSince(isoStart) {
  const result = await execGit(["log", `--since=${isoStart}`, "--pretty=format:%h|%cI|%an|%s"]);
  if (!result.ok) return [];
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [short, committedAt, author, ...rest] = line.split("|");
      return { short, committedAt, author, subject: rest.join("|") };
    });
}

function bucketBy(arr, key) {
  const out = {};
  for (const item of arr) out[item[key]] = (out[item[key]] || 0) + 1;
  return out;
}

function timeOnly(iso) {
  return iso ? iso.slice(11, 19) : "—";
}

function clip(s, n) {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export async function generateSessionReport({ minutes = 60 } = {}) {
  const now = Date.now();
  const startMs = now - minutes * 60_000;
  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(now).toISOString();

  const [events, tasks, proposalsAll, swarm, subscriptions, designLab, sportsRadar, buzzrDrafts, designLib] = await Promise.all([
    readArchivedEvents({ sinceMs: startMs, untilMs: now, limit: 5000 }),
    listTasks(),
    getProposals(500),
    Promise.resolve(getSwarmStatus()),
    listSubscriptionTasks(),
    getThemedItems("design_lab", 100),
    getThemedItems("sports_radar", 100),
    getThemedItems("buzzr_drafts", 100),
    getThemedItems("design_library", 100)
  ]);
  const commits = await commitsSince(startIso);

  const inWindow = (created) => {
    const ts = new Date(created).getTime();
    return ts >= startMs && ts <= now;
  };

  const tasksInWin = tasks.filter((t) => inWindow(t.createdAt));
  const tasksDoneInWin = tasks.filter((t) => t.status === "done" && t.updatedAt && inWindow(t.updatedAt));
  const proposalsInWin = proposalsAll.filter((p) => inWindow(p.createdAt));
  const sportsInWin = sportsRadar.filter((i) => inWindow(i.createdAt));
  const buzzrInWin = buzzrDrafts.filter((i) => inWindow(i.createdAt));
  const designLabInWin = designLab.filter((i) => inWindow(i.createdAt));
  const designLibInWin = designLib.filter((i) => inWindow(i.createdAt));
  const subsInWin = subscriptions.filter((s) => inWindow(s.createdAt));

  const eventsByType = bucketBy(events, "type");
  const eventsByMission = {};
  for (const e of events) {
    const sid = e.sessionId || "";
    if (sid.startsWith("swarm_")) {
      const label = sid.slice(6);
      eventsByMission[label] = (eventsByMission[label] || 0) + 1;
    }
  }
  const errors = events.filter((e) => e.type === "error");
  const thinking = events.filter((e) => e.type === "thinking");
  const observations = events.filter((e) => e.type === "mission_update").filter((e) => /^\[observer/i.test(e.content || ""));
  const critiques = events.filter((e) => e.type === "mission_update").filter((e) => /^\[critic/i.test(e.content || ""));

  const proposalCounts = bucketBy(proposalsInWin, "status");
  const tasksByMission = bucketBy(tasksInWin, "mission");

  const lines = [
    `# Hermes Session Report`,
    "",
    `**Window:** ${startIso} → ${endIso}  (${minutes} min)`,
    `**Generated:** ${new Date(now).toISOString()}`,
    "",
    `## Swarm cycles (current totals)`,
    "",
    swarm.workers
      .map((w) => `- **${w.label}** — cycles ${w.cycles}, every ${Math.round(w.intervalMs / 1000)}s, last result: \`${clip(w.lastResult || "", 80)}\``)
      .join("\n"),
    "",
    `## Events (${events.length} in window)`,
    "",
    Object.entries(eventsByType)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `- ${k}: ${v}`)
      .join("\n"),
    "",
    `### By swarm worker (sessionId prefix swarm_)`,
    Object.entries(eventsByMission).length === 0
      ? "- (none)"
      : Object.entries(eventsByMission)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `- ${k}: ${v}`)
          .join("\n"),
    "",
    `## Tasks`,
    `- created in window: **${tasksInWin.length}**`,
    `- closed in window:  **${tasksDoneInWin.length}**`,
    "",
    `### New tasks by mission`,
    Object.entries(tasksByMission).length === 0
      ? "- (none)"
      : Object.entries(tasksByMission)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `- [${k}]: ${v}`)
          .join("\n"),
    "",
    `### New task titles`,
    tasksInWin.length === 0
      ? "- (none)"
      : tasksInWin.slice(0, 30).map((t) => `- [${t.mission}] ${clip(t.title, 120)}  \`${t.id}\``).join("\n"),
    "",
    `## Proposals (${proposalsInWin.length} in window)`,
    "",
    Object.entries(proposalCounts)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join("\n") || "- (none)",
    "",
    `### Proposal detail`,
    proposalsInWin.length === 0
      ? "- (none)"
      : proposalsInWin
          .slice(0, 20)
          .map(
            (p) =>
              `- ${timeOnly(p.createdAt)} **${p.status}** — ${clip(p.title, 80)}${p.declineReason ? `  \n  - ✗ ${clip(p.declineReason, 200)}` : ""}${p.runResult?.exitCode === 0 ? `  \n  - ✓ exit 0 in ${p.runResult?.durationMs ?? "?"}ms` : ""}`
          )
          .join("\n"),
    "",
    `## Sports headlines (${sportsInWin.length})`,
    sportsInWin.length === 0
      ? "- (none)"
      : sportsInWin.slice(0, 10).map((s) => `- [${s.league || "?"}] ${clip(s.headline || "", 140)}`).join("\n"),
    "",
    `## Buzzr drafts (${buzzrInWin.length})`,
    buzzrInWin.length === 0
      ? "- (none)"
      : buzzrInWin.slice(0, 8).map((d) => `- ${clip(d.text || "", 200)}`).join("\n"),
    "",
    `## Design Lab experiments (${designLabInWin.length})`,
    designLabInWin.length === 0
      ? "- (none)"
      : designLabInWin.slice(0, 8).map((d) => `- ${clip(d.title || "", 80)} — ${clip(d.description || "", 120)}`).join("\n"),
    "",
    `## Design Library entries (${designLibInWin.length})`,
    designLibInWin.length === 0
      ? "- (none)"
      : designLibInWin.slice(0, 8).map((d) => `- ${clip(d.title || "", 80)} (${d.sourceUrl || ""})`).join("\n"),
    "",
    `## Critic flags (${critiques.length})`,
    critiques.length === 0
      ? "- (none)"
      : critiques.slice(0, 10).map((c) => `- ${timeOnly(c.createdAt)} ${clip(c.content || "", 200)}`).join("\n"),
    "",
    `## Subscriptions dispatched (${subsInWin.length})`,
    subsInWin.length === 0
      ? "- (none)"
      : subsInWin.slice(0, 10).map((s) => `- ${s.provider} → ${clip(s.intent || "", 140)}  \`${s.id}\``).join("\n"),
    "",
    `## Commits during window (${commits.length})`,
    commits.length === 0
      ? "- (none)"
      : commits.slice(0, 30).map((c) => `- \`${c.short}\` ${c.subject} _by ${c.author} at ${timeOnly(c.committedAt)}_`).join("\n"),
    "",
    `## Errors (${errors.length})`,
    errors.length === 0
      ? "- (none)"
      : errors.slice(0, 10).map((e) => `- ${timeOnly(e.createdAt)} ${clip(e.content || "", 200)}`).join("\n"),
    "",
    `## Sample observations (${observations.length})`,
    observations.length === 0
      ? "- (none)"
      : observations.slice(0, 8).map((o) => `- ${timeOnly(o.createdAt)} ${clip(o.content || "", 200)}`).join("\n"),
    "",
    `## Sample thinking (${thinking.length})`,
    thinking.length === 0
      ? "- (none)"
      : thinking.slice(0, 8).map((t) => `- ${timeOnly(t.createdAt)} ${clip(t.content || "", 200)}`).join("\n"),
    "",
    `## Next-round improvement ideas (machine-derived)`,
    deriveImprovementHints({ proposalsInWin, errors, eventsByType, tasksInWin }),
    ""
  ];

  const markdown = lines.filter((l) => l !== undefined).join("\n");

  // Mirror to vault — one file per generated report.
  try {
    await fs.mkdir(REPORTS_DIR, { recursive: true });
    const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
    const file = path.join(REPORTS_DIR, `session-${stamp}-${minutes}m.md`);
    await fs.writeFile(file, markdown, "utf8");
  } catch {
    // best-effort
  }

  return {
    generatedAt: endIso,
    startedAt: startIso,
    minutes,
    counts: {
      events: events.length,
      tasksCreated: tasksInWin.length,
      tasksClosed: tasksDoneInWin.length,
      proposalsTotal: proposalsInWin.length,
      proposalsByStatus: proposalCounts,
      sportsHeadlines: sportsInWin.length,
      buzzrDrafts: buzzrInWin.length,
      designLab: designLabInWin.length,
      designLibrary: designLibInWin.length,
      critiques: critiques.length,
      commits: commits.length,
      errors: errors.length,
      thinking: thinking.length
    },
    markdown
  };
}

function deriveImprovementHints({ proposalsInWin, errors, eventsByType, tasksInWin }) {
  const hints = [];
  const rejected = proposalsInWin.filter((p) => p.status === "rejected");
  if (rejected.length > proposalsInWin.length * 0.5 && proposalsInWin.length > 4) {
    hints.push(
      `- High rejection rate (${rejected.length}/${proposalsInWin.length}) — executor + selfimprove are still drafting no-op pipelines. Consider tightening their system prompts with concrete diff examples or requiring them to call diff_preview server-side before submitting.`
    );
  }
  if ((eventsByType.error || 0) > 6) {
    hints.push(`- ${eventsByType.error} error events — investigate top error types and add specific resilience.`);
  }
  if (tasksInWin.length > 30 && (eventsByType.run_result || 0) < 5) {
    hints.push(`- Lots of tasks created (${tasksInWin.length}) but few run_result events. Tasks are accumulating without execution; lean executor or auto-apply.`);
  }
  if ((eventsByType.thinking || 0) < 5) {
    hints.push(`- Low thinking-event count — workers aren't narrating. Consider stricter system prompts or fall-through always-emit.`);
  }
  if (!hints.length) {
    hints.push("- (no automatic flags — review manually)");
  }
  return hints.join("\n");
}
