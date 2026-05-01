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

function latestRunCommand(payload: DashboardPayload) {
  return payload.runRequests[0]?.command || "no command queued";
}

export function buildConsoleNodes(payload: DashboardPayload): ConsoleNode[] {
  const openTasks = payload.reviewQueues.reduce((sum, queue) => sum + queue.openTaskCount, 0);
  const changedProjects = payload.projects.filter((project) => project.git?.changedFiles).length;
  const pendingRuns = payload.runRequests.filter((request) => request.status === "pending").length;
  const blockedRuns = payload.runRequests.filter((request) => request.status === "blocked").length;
  const activeRefs = payload.designReferences.map((reference) => reference.name).join(" + ") || "Antimetal";
  const latestLocal = payload.localMessages[0]?.body || "no local message yet";

  return [
    {
      id: "hermes",
      label: "Hermes",
      metric: payload.status.gateway,
      x: 50,
      y: 16,
      signal: "live",
      copy: `Hermes is ${payload.status.gateway}; Telegram is ${payload.status.homeChannel}. Model ${payload.status.model} is reading local signals, not mutating outside approved gates.`
    },
    {
      id: "builder",
      label: "Builder",
      metric: payload.status.builderLoop?.autoRun ? "auto-check" : "sandboxed",
      x: 23,
      y: 34,
      signal: "watch",
      copy: `Builder loop is ${payload.status.builderLoop?.state || "starting"} with ${payload.status.builderLoop?.autoRun ? "safe auto-run checks" : "manual approval checks"}. It cannot install, push, delete, deploy, spend, or leave ${payload.status.projectSandbox}.`
    },
    {
      id: "run-queue",
      label: "Run Queue",
      metric: plural(payload.runRequests.length, "request"),
      x: 77,
      y: 34,
      signal: blockedRuns ? "blocked" : "live",
      copy: `Run Queue has ${plural(payload.runRequests.length, "request")}; ${pendingRuns} pending, ${blockedRuns} blocked. Latest signal: ${latestRunCommand(payload)}.`
    },
    {
      id: "local-console",
      label: "Local Console",
      metric: plural(payload.localMessages.length, "message"),
      x: 50,
      y: 84,
      signal: "live",
      copy: `Local Console is the dashboard channel equal to Telegram for Sarvesh-to-Hermes instructions. Latest local message: ${latestLocal}.`
    },
    {
      id: "obsidian",
      label: "Obsidian",
      metric: plural(openTasks, "open task"),
      x: 17,
      y: 70,
      signal: "memory",
      copy: `Obsidian is the agent memory layer: ${plural(payload.reviewQueues.length, "queue")} scanned, ${plural(openTasks, "open task")} waiting for review, action requests stay visible.`
    },
    {
      id: "projects",
      label: "Projects",
      metric: plural(payload.projects.length, "project"),
      x: 50,
      y: 78,
      signal: changedProjects ? "watch" : "live",
      copy: `Project radar sees ${plural(payload.projects.length, "project")} and ${plural(changedProjects, "changed repo", "changed repos")}; it reads package scripts and risk flags before proposing builds.`
    },
    {
      id: "design-memory",
      label: "Design Memory",
      metric: activeRefs,
      x: 83,
      y: 70,
      signal: "memory",
      copy: `Design Memory pins ${activeRefs}. Antimetal controls this console; Refero is only a source for future style discovery when Sarvesh chooses a new direction.`
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

  return [
    `OBSERVE queues=${payload.reviewQueues.length} projects=${payload.projects.length} changed=${changedProjects} local="${latestLocalMessage}" change="${latestChange}" improvement="${latestImprovement}" memory="${latestLearning}"`,
    `ASSESS loop=${loop?.state || "unknown"} improve=${improvementLoop?.state || "unknown"} autorun=${loop?.autoRun ? "on" : "off"} pending=${pendingRuns} blocked=${blockedRuns} complete=${completedRuns}`,
    `PUBLISH state=${payload.publishStatus.state} remote=${payload.publishStatus.remote}`,
    pendingRuns
      ? "DECIDE hold: pending local approval before any queued command runs"
      : "DECIDE continue: queue clear, safe heartbeat can verify the console",
    latestRun
      ? `NEXT inspect ${latestRun.command} -> ${latestRun.status}${latestRun.exitCode === undefined ? "" : `:${latestRun.exitCode}`}`
      : "NEXT wait for a Telegram/dashboard request or next builder heartbeat",
    "GUARD no arbitrary shell / no installs / no deletes / no pushes / no deploys / no spend / no secrets"
  ];
}
