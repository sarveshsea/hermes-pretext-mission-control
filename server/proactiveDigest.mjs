// Proactive Telegram digest. Every N hours, Hermes sends Sarvesh a status
// summary covering: pipeline ships in window, today's career intel headline
// (fresh reqs / materials), recent commits, anything stuck waiting for him.
//
// User explicitly asked for this: "its not sending me messages on telegram
// nothing." The grounding rules I added are reactive. This is the push half.

import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { getPowerMetrics } from "./powerMetrics.mjs";
import { getPipelineStatus } from "./pipelineWorker.mjs";
import { listSubscriptionTasks } from "./subscriptions.mjs";
import { sendTelegramMessage } from "./telegram.mjs";
import { listTasks } from "./taskLedger.mjs";
import { appendHermesEvent } from "./hermesEvents.mjs";

const TICK_MS = Number(process.env.PRETEXT_DIGEST_INTERVAL_MS || 4 * 60 * 60_000); // 4h
const QUIET_HOURS = (process.env.PRETEXT_DIGEST_QUIET_HOURS || "0,1,2,3,4,5,6").split(",").map(Number);

let timer = null;
let lastSentAt = null;
let lastResult = "boot";

function execGit(args) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd: ROOTS.project, timeout: 4000, maxBuffer: 256 * 1024 }, (error, stdout) => {
      resolve({ ok: !error, stdout: (stdout || "").toString().trim() });
    });
  });
}

async function readLatestCareerNote() {
  try {
    const dir = path.join(ROOTS.hermesOps, "runs");
    const files = await fs.readdir(dir);
    const md = files.filter((f) => f.endsWith(".md")).sort().reverse();
    if (!md.length) return null;
    const text = await fs.readFile(path.join(dir, md[0]), "utf8");
    // Pull the headline numbers we care about: fresh reqs, today's apps, materials.
    const fresh = text.match(/Fresh requisitions:\s*`(\d+)`/);
    const apps = text.match(/Applications:\s*total\s*`(\d+)`/);
    const cvs = text.match(/Materials generated today:\s*`(\d+)`\s*CVs/);
    const today = text.match(/Today\s*\(([0-9]+)\)/);
    return {
      file: md[0],
      fresh: fresh ? Number(fresh[1]) : null,
      apps: apps ? Number(apps[1]) : null,
      cvs: cvs ? Number(cvs[1]) : null,
      today: today ? Number(today[1]) : 0
    };
  } catch {
    return null;
  }
}

async function buildDigest() {
  const [power, pipeline, openTasks, queuedSubs, commitsResult, careerNote] = await Promise.all([
    getPowerMetrics({ windowMinutes: 4 * 60 }),
    Promise.resolve(getPipelineStatus()),
    listTasks({ status: "open" }),
    listSubscriptionTasks({ status: "queued" }),
    execGit(["log", "--since=4 hours ago", "--pretty=format:%h %s"]),
    readLatestCareerNote()
  ]);
  const commits = (commitsResult.stdout || "")
    .split("\n")
    .filter(Boolean)
    .filter((l) => !/Automated Pretext improvement: Local Console/.test(l))
    .slice(0, 6);

  const stuck = openTasks.filter((t) => (t.pipelineState?.attempts || 0) >= 2).slice(0, 5);
  const lines = [];
  lines.push(`*Hermes 4h status* — ${new Date().toISOString().slice(11, 16)}Z`);
  lines.push("");
  lines.push(`*Pipeline:* ${power.proposals_accepted_per_hour} applied, ${power.pipeline_submits} submitted, ${power.pipeline_abandons} abandoned (${power.pipeline_success_rate}% submit rate)`);
  lines.push(`*Files modified:* ${power.unique_files_modified_per_hour}`);
  if (pipeline.intervalMs > pipeline.baseIntervalMs) {
    lines.push(`*Cadence:* ⚠ backed off to ${Math.round(pipeline.intervalMs / 1000)}s (baseline ${Math.round(pipeline.baseIntervalMs / 1000)}s)`);
  }
  lines.push("");

  if (commits.length) {
    lines.push(`*Real commits this window (${commits.length}):*`);
    for (const c of commits) lines.push(`  • \`${c}\``);
  } else {
    lines.push("*Commits:* 0 real (auto-publish noise excluded)");
  }
  lines.push("");

  if (careerNote) {
    lines.push(`*Career intel:* ${careerNote.fresh ?? "?"} fresh reqs today, ${careerNote.cvs ?? "?"} CVs + ${careerNote.cvs ?? "?"} covers generated, ${careerNote.apps ?? "?"} total tracked applications`);
    if (careerNote.today) lines.push(`  • ${careerNote.today} apps dated today`);
  }
  lines.push("");

  if (queuedSubs.length) {
    lines.push(`*Awaiting your approval (${queuedSubs.length}):*`);
    for (const s of queuedSubs.slice(0, 3)) {
      lines.push(`  • [${s.provider}] ${(s.intent || "").slice(0, 90)}`);
    }
  }

  if (stuck.length) {
    lines.push(`*Tasks stuck (${stuck.length}, ≥2 attempts):*`);
    for (const t of stuck) {
      const attempts = t.pipelineState?.attempts || 0;
      lines.push(`  • ${(t.title || "").slice(0, 70)} — ${attempts} attempts: ${(t.pipelineState?.lastError || "").slice(0, 60)}`);
    }
  }

  return lines.join("\n").slice(0, 3500);
}

async function tick() {
  try {
    const hour = new Date().getHours();
    if (QUIET_HOURS.includes(hour)) {
      lastResult = `quiet hour ${hour}, skipped`;
      return;
    }
    const text = await buildDigest();
    const send = await sendTelegramMessage({ text });
    lastSentAt = new Date().toISOString();
    if (send?.ok) {
      lastResult = `sent ${text.length}B`;
      await appendHermesEvent({
        type: "memory_write",
        role: "system",
        content: `proactive digest sent to Telegram (${text.length}B)`,
        extra: { length: text.length }
      });
    } else {
      lastResult = `send failed: ${send?.reason || "unknown"}`;
    }
  } catch (error) {
    lastResult = `tick error: ${error?.message || "unknown"}`;
  }
}

export function startProactiveDigest() {
  if (timer) return timer;
  if (process.env.PRETEXT_DIGEST === "false") return null;
  // First fire 5 min after boot so Sarvesh sees a digest right away.
  setTimeout(() => void tick(), 5 * 60_000);
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();
  return timer;
}

export function getProactiveDigestStatus() {
  return {
    state: timer ? "running" : "stopped",
    intervalMs: TICK_MS,
    quietHours: QUIET_HOURS,
    lastSentAt,
    lastResult
  };
}

// Manual trigger for the dashboard "send now" button.
export async function fireDigestNow() {
  await tick();
  return getProactiveDigestStatus();
}
