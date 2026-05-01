// Server-derived 1-line summary per pane. Each pane component reads its own
// summary and renders it as the SECOND-LARGEST line under the title — so the
// eye lands on something information-dense before drilling into the body.

import { listTasks } from "./taskLedger.mjs";
import { getProposals } from "./proposals.mjs";
import { getHermesEvents } from "./hermesEvents.mjs";
import { getSwarmStatus } from "./workerSwarm.mjs";
import { getPipelineStatus } from "./pipelineWorker.mjs";
import { getPowerMetrics } from "./powerMetrics.mjs";

function pct(num, denom) {
  if (!denom) return "—";
  return `${Math.round((num / denom) * 100)}%`;
}

export async function getPaneSummaries() {
  const [tasks, proposals, events, swarm, pipeline, power] = await Promise.all([
    listTasks(),
    getProposals(80),
    getHermesEvents(200),
    Promise.resolve(getSwarmStatus()),
    Promise.resolve(getPipelineStatus()),
    getPowerMetrics({ windowMinutes: 60 })
  ]);

  const open = tasks.filter((t) => t.status === "open");
  const editShaped = open.filter((t) => (t.tags || []).includes("edit-shaped"));
  const needsDesign = open.filter((t) => (t.tags || []).includes("needs_design"));
  const inPipeline = open.filter((t) => t.pipelineState?.phase);
  const done = tasks.filter((t) => t.status === "done").length;
  const abandoned = tasks.filter((t) => t.status === "abandoned").length;

  const editProposals = proposals.filter((p) => p.kind === "edit");
  const applied = proposals.filter((p) => p.status === "applied").length;
  const pending = proposals.filter((p) => p.status === "pending").length;
  const rejected = proposals.filter((p) => p.status === "rejected").length;

  const sw = swarm.workers || [];
  const swarmHealthy = sw.filter((w) => w.lastResult && !w.lastError).length;

  const summaries = {
    ledger: `${open.length} open (${editShaped.length} edit-shaped · ${needsDesign.length} needs-design · ${inPipeline.length} in-pipeline) · ${done} done · ${abandoned} abandoned`,
    proposals: `${pending} pending · ${applied} applied · ${rejected} rejected · ${editProposals.length} of all-time were edit-kind`,
    pipeline: `${pipeline.totalTicks} ticks · ${pipeline.totalShipped} shipped · interval ${Math.round(pipeline.intervalMs / 1000)}s · last: ${(pipeline.lastResult || "").slice(0, 80)}`,
    swarm: `${sw.length} workers · ${swarmHealthy} healthy · top: ${sw.slice().sort((a, b) => b.cycles - a.cycles).slice(0, 1).map((w) => `${w.label} ${w.cycles}cyc`)[0] || "—"}`,
    power: `done/hr ${power.tasks_done_per_hour} · applied/hr ${power.proposals_accepted_per_hour} · files ${power.unique_files_modified_per_hour} · pipe ${power.pipeline_success_rate}%`,
    live: `${events.length} recent events · types: ${Object.entries(eventCounts(events)).slice(0, 3).map(([t, n]) => `${t}=${n}`).join(", ")}`,
    thinking: lastThinking(events),
    health: { ok: true } // placeholder; HEALTH pane has its own dense data
  };
  // Health dot per pane (green/amber/red).
  const dots = computeDots({ pipeline, power, swarm, events, proposals });
  return { summaries, dots, generatedAt: new Date().toISOString() };
}

function eventCounts(events) {
  const buckets = {};
  for (const e of events) buckets[e.type] = (buckets[e.type] || 0) + 1;
  return Object.fromEntries(Object.entries(buckets).sort((a, b) => b[1] - a[1]));
}

function lastThinking(events) {
  const t = events.find((e) => e.type === "thinking");
  if (!t) return "(no recent thinking)";
  return (t.content || "").replace(/^\[[^\]]+\]\s*/, "").slice(0, 100);
}

function computeDots({ pipeline, power, swarm, events, proposals }) {
  // pipeline: green if shipped recently, amber if ticking but not shipping, red if all aborts
  const pipeOutcomes = pipeline.recentOutcomes || [];
  const pipeAborts = pipeOutcomes.filter((o) => o === "abandon").length;
  let pipelineDot = "amber";
  if (pipeline.totalShipped > 0 && pipeAborts < pipeOutcomes.length) pipelineDot = "green";
  else if (pipeOutcomes.length >= 3 && pipeAborts === pipeOutcomes.length) pipelineDot = "red";

  // proposals: green if applied recently, amber if pending only, red if all rejected
  const recentProps = proposals.slice(0, 10);
  const recentApplied = recentProps.filter((p) => p.status === "applied").length;
  const recentRejected = recentProps.filter((p) => p.status === "rejected").length;
  let proposalsDot = "amber";
  if (recentApplied > 0) proposalsDot = "green";
  else if (recentProps.length >= 5 && recentApplied === 0 && recentRejected >= 4) proposalsDot = "red";

  // swarm: green if all workers have a recent result, red if many errors
  const sw = swarm.workers || [];
  const errored = sw.filter((w) => w.lastError).length;
  let swarmDot = "green";
  if (errored > sw.length / 3) swarmDot = "red";
  else if (errored > 0) swarmDot = "amber";

  return {
    pipeline: pipelineDot,
    proposals: proposalsDot,
    swarm: swarmDot,
    power: power.proposals_accepted_per_hour > 0 ? "green" : power.unique_files_modified_per_hour > 0 ? "amber" : "red",
    ledger: "green",
    live: events.length > 30 ? "green" : "amber",
    thinking: events.find((e) => e.type === "thinking" && Date.now() - new Date(e.createdAt).getTime() < 120_000) ? "green" : "amber"
  };
}
