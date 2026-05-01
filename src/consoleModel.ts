import type { DashboardPayload } from "./api";

export type ConsoleNodeId =
  | "hermes"
  | "builder"
  | "run-queue"
  | "local-console"
  | "obsidian"
  | "projects"
  | "design-memory";

export type ConsoleNode = {
  id: ConsoleNodeId;
  label: string;
  metric: string;
  x: number;
  y: number;
  copy: string;
  signal: "live" | "watch" | "blocked" | "memory";
};

function plural(count: number, singular: string, pluralLabel = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

function shortDuration(seconds: number | null | undefined) {
  if (!seconds || !Number.isFinite(seconds)) return "0s";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m${seconds % 60 ? `${seconds % 60}s` : ""}`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86_400)}d${Math.floor((seconds % 86_400) / 3600)}h`;
}

export function buildConsoleNodes(payload: DashboardPayload): ConsoleNode[] {
  const openTasks = payload.reviewQueues.reduce((sum, queue) => sum + queue.openTaskCount, 0);
  const changedProjects = payload.projects.filter((project) => project.git?.changedFiles).length;
  const pendingRuns = payload.runRequests.filter((request) => request.status === "pending").length;
  const blockedRuns = payload.runRequests.filter((request) => request.status === "blocked").length;
  const completedRuns = payload.runRequests.filter((request) => request.status === "completed").length;
  const activeRefs = payload.designReferences.map((reference) => reference.name).join(" + ") || "Antimetal";
  const latestLocal = payload.localMessages[0]?.body || "no local message yet";
  const health = payload.health;
  const ollama = health?.ollama;
  const gateway = health?.gateway;
  const sessions = payload.sessions?.sessions ?? [];
  const skills = payload.skills;
  const git = payload.git;
  const memoryFiles = payload.memoryFiles?.count ?? 0;
  const rate1m = payload.mission?.rate1m ?? 0;

  return [
    {
      id: "hermes",
      label: "Hermes",
      metric: gateway?.running
        ? `pid ${gateway.pid} · up ${shortDuration(gateway.etimeSec)} · ${rate1m}/m`
        : "gateway DOWN",
      x: 50,
      y: 16,
      signal: gateway?.running ? "live" : "blocked",
      copy: `Hermes gateway ${gateway?.running ? `is up (pid ${gateway.pid}, ${shortDuration(gateway.etimeSec)})` : "is DOWN"}. Telegram home channel ${payload.status.homeChannel}. Default model ${payload.status.model}; Ollama ${ollama?.up ? `up (${ollama.latencyMs}ms, ${ollama.models.length} models)` : "DOWN"}.`
    },
    {
      id: "builder",
      label: "Builder",
      metric: payload.status.builderLoop?.autoRun ? `auto · ${completedRuns} runs` : "manual",
      x: 23,
      y: 34,
      signal: "watch",
      copy: `Builder loop is ${payload.status.builderLoop?.state || "starting"}; ${plural(completedRuns, "completed run")}, ${plural(pendingRuns, "pending")}. Auto-run ${payload.status.builderLoop?.autoRun ? "ON" : "OFF"}.`
    },
    {
      id: "run-queue",
      label: "Run Queue",
      metric: `${plural(payload.runRequests.length, "request")} · ${pendingRuns} pend`,
      x: 77,
      y: 34,
      signal: blockedRuns ? "blocked" : "live",
      copy: `Run Queue has ${plural(payload.runRequests.length, "request")} (${pendingRuns} pending, ${completedRuns} complete). Latest: ${payload.runRequests[0]?.command || "—"}.`
    },
    {
      id: "local-console",
      label: "Local Console",
      metric: `${plural(payload.localMessages.length, "msg")} · ${plural(sessions.length, "session")}`,
      x: 50,
      y: 84,
      signal: "live",
      copy: `Local Console has ${plural(payload.localMessages.length, "message")}. ${plural(sessions.length, "active Telegram session")} mirrored. Latest: ${latestLocal}.`
    },
    {
      id: "obsidian",
      label: "Obsidian",
      metric: `${plural(openTasks, "open task")} · ${plural(memoryFiles, "memory")}`,
      x: 17,
      y: 70,
      signal: "memory",
      copy: `Obsidian: ${plural(payload.reviewQueues.length, "queue")} scanned, ${plural(openTasks, "open task")} pending, ${plural(memoryFiles, "memory file")} loaded. Vault ${health?.vault?.accessible ? "accessible" : "MISSING"}.`
    },
    {
      id: "projects",
      label: "Projects",
      metric: `${plural(payload.projects.length, "proj")}${git ? ` · ${git.dirty ? `${git.dirtyFiles}* dirty` : "clean"}` : ""}`,
      x: 50,
      y: 78,
      signal: changedProjects ? "watch" : "live",
      copy: `Project radar: ${plural(payload.projects.length, "project")}, ${plural(changedProjects, "with uncommitted changes")}. This repo ${git?.branch || "unknown"} @${git?.head || "?"}; push auth ${git?.pushAuth?.ok ? "OK" : "FAILED"}.`
    },
    {
      id: "design-memory",
      label: "Design Memory",
      metric: skills ? `${skills.activeCount}/${skills.totalCount} skills` : activeRefs,
      x: 83,
      y: 70,
      signal: "memory",
      copy: `Design Memory pins ${activeRefs}. ${skills ? `${skills.activeCount} active / ${skills.disabledCount} disabled skills loaded into Hermes.` : ""}`
    }
  ];
}

export function activeNodeCopy(nodes: ConsoleNode[], activeId: ConsoleNodeId) {
  return nodes.find((node) => node.id === activeId)?.copy || nodes[0]?.copy || "";
}

export function buildWorkTrace(payload: DashboardPayload) {
  const pendingRuns = payload.runRequests.filter((request) => request.status === "pending").length;
  const completedRuns = payload.runRequests.filter((request) => request.status === "completed").length;
  const blockedRuns = payload.runRequests.filter((request) => request.status === "blocked").length;
  const changedProjects = payload.projects.filter((project) => project.git?.changedFiles).length;
  const latestRun = payload.runRequests[0];
  const latestLearning = payload.learnings[0]?.title || "no recent memory note";
  const latestLocalMessage = payload.localMessages[0]?.body || "no local dashboard message";
  const latestChange = payload.changelog[0]?.title || "no changelog entry";
  const latestImprovement = payload.improvementEvents[0]?.title || "no improvement event";
  const loop = payload.status.builderLoop;
  const improvementLoop = payload.status.improvementLoop;
  const health = payload.health;

  return [
    `OBSERVE queues=${payload.reviewQueues.length} projects=${payload.projects.length} changed=${changedProjects} local="${latestLocalMessage}" change="${latestChange}" improvement="${latestImprovement}" memory="${latestLearning}"`,
    `ASSESS loop=${loop?.state || "unknown"} improve=${improvementLoop?.state || "unknown"} autorun=${loop?.autoRun ? "on" : "off"} pending=${pendingRuns} blocked=${blockedRuns} complete=${completedRuns}`,
    `HEALTH ollama=${health?.ollama?.up ? "up" : "down"} gateway=${health?.gateway?.running ? "up" : "down"} disk=${health?.disk?.usedPct ?? "?"}% vault=${health?.vault?.accessible ? "ok" : "missing"} score=${health?.healthScore ?? "?"}`,
    `PUBLISH state=${payload.publishStatus.state} remote=${payload.publishStatus.remote}`,
    pendingRuns
      ? "DECIDE hold: pending local approval before any queued command runs"
      : "DECIDE continue: queue clear, safe heartbeat can verify the console",
    latestRun
      ? `NEXT inspect ${latestRun.command} -> ${latestRun.status}${latestRun.exitCode === undefined ? "" : `:${latestRun.exitCode}`}`
      : "NEXT wait for a Telegram/dashboard request or next builder heartbeat",
    "GUARD yolo_local · public_via_gate · sarvesh_code_loaded"
  ];
}
