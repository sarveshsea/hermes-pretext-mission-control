// Honest progress signal. Today's dashboard celebrates volume (event count,
// task count, proposal count) — all three grew while real work was zero.
// Power metrics flip the framing: only commits to real files count.

import { execFile } from "node:child_process";
import { ROOTS } from "./config.mjs";
import { listTasks } from "./taskLedger.mjs";
import { getProposals } from "./proposals.mjs";
import { getHermesEvents } from "./hermesEvents.mjs";

function execGit(args) {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd: ROOTS.project, timeout: 4000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        resolve({ ok: !error, stdout: (stdout || "").toString() });
      }
    );
  });
}

export async function getPowerMetrics({ windowMinutes = 60 } = {}) {
  const now = Date.now();
  const since = now - windowMinutes * 60_000;
  const sinceIso = new Date(since).toISOString();
  const inWindow = (iso) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return t >= since && t <= now;
  };

  // tasks_closed_per_hour — tasks with status "done" or "abandoned" updated in window.
  const allTasks = await listTasks();
  const tasksClosed = allTasks.filter((t) => (t.status === "done" || t.status === "abandoned") && inWindow(t.updatedAt)).length;
  const tasksDone = allTasks.filter((t) => t.status === "done" && inWindow(t.updatedAt)).length;

  // proposals_accepted_per_hour — kind="edit" or shell that ended status="applied".
  const props = await getProposals(200);
  const proposalsApplied = props.filter((p) => p.status === "applied" && inWindow(p.decidedAt || p.createdAt)).length;
  const proposalsRejected = props.filter((p) => p.status === "rejected" && inWindow(p.createdAt)).length;

  // unique_files_modified_per_hour — git log --since within the window.
  const log = await execGit(["log", `--since=${sinceIso}`, "--name-only", "--pretty=format:"]);
  const fileSet = new Set(
    (log.stdout || "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("data/") && l !== ".")
  );
  const filesModified = fileSet.size;

  // pipeline_success_rate — pipeline_step events: closePhase / pickTask.
  const events = await getHermesEvents(2000);
  const inWin = events.filter((e) => inWindow(e.createdAt));
  const pipelinePicks = inWin.filter((e) => e.type === "pipeline_step" && /\[pickTask\]/.test(e.content || "")).length;
  const pipelineSubmits = inWin.filter((e) => e.type === "pipeline_step" && /\[submit\]/.test(e.content || "")).length;
  const pipelineAbandons = inWin.filter((e) => e.type === "pipeline_step" && /\[abandon\]/.test(e.content || "")).length;

  return {
    generatedAt: new Date(now).toISOString(),
    windowMinutes,
    tasks_closed_per_hour: tasksClosed,
    tasks_done_per_hour: tasksDone,
    proposals_accepted_per_hour: proposalsApplied,
    proposals_rejected_per_hour: proposalsRejected,
    unique_files_modified_per_hour: filesModified,
    pipeline_picks: pipelinePicks,
    pipeline_submits: pipelineSubmits,
    pipeline_abandons: pipelineAbandons,
    pipeline_success_rate: pipelinePicks > 0 ? Math.round((pipelineSubmits / pipelinePicks) * 100) : 0
  };
}
