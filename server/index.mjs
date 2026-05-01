import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createServer as createViteServer } from "vite";
import { startBuilderLoop } from "./builderLoop.mjs";
import { getChangelog } from "./changelog.mjs";
import { getImprovementEvents, startImprovementLoop } from "./improvementLoop.mjs";
import {
  getDashboardPayload,
  getDesignReferences,
  getLearnings,
  getProjects,
  getReviewQueues,
  getStatus
} from "./data.mjs";
import {
  appendHermesEvent,
  getHermesEvents,
  subscribeHermesEvents
} from "./hermesEvents.mjs";
import {
  getHermesRuntime,
  recordRuntimeActivity,
  setAutoApprove,
  setHermesModel
} from "./hermesRuntime.mjs";
import {
  createPublicIntent,
  decidePublicIntent,
  getPendingPublicIntents,
  getPublicIntents,
  subscribePublicIntents
} from "./publicIntents.mjs";
import { getMissionState } from "./missions.mjs";
import { startObsidianLogger } from "./obsidianLogger.mjs";
import { probeSystem } from "./systemProbe.mjs";
import { getHermesSessions } from "./sessions.mjs";
import { getHermesSkills } from "./skills.mjs";
import { getMemoryFiles } from "./memoryFiles.mjs";
import { getEventTimeline } from "./timeline.mjs";
import { getGitState } from "./git.mjs";
import {
  createProposal,
  decideProposal,
  getPendingProposals,
  getProposals
} from "./proposals.mjs";
import { getCadence } from "./scheduler.mjs";
import { startAutoApplyLoop, getAutoApplyStatus } from "./autoApply.mjs";
import { getMorningBrief, noteCadenceTransition } from "./morningBrief.mjs";
import { linkGraph, readNote, startObsidianWatcher, walkVault, writeNote } from "./obsidian.mjs";
import { addTask, listTasks, updateTask } from "./taskLedger.mjs";
import { createPlan, getPlan, listPlans, recordStepResult, reflect } from "./harness.mjs";
import { THEMED_SURFACES, getAllThemedSummaries, getThemedItems, postThemedItem } from "./themedSurfaces.mjs";
import { getOutboundStatus, sendTelegramMessage, setOutboundEnabled } from "./telegram.mjs";
import { getOllamaWarmStatus, startOllamaWarm } from "./ollamaWarm.mjs";
import { getLayout, resetLayout, updateLayout } from "./dashboardLayout.mjs";
import { getProcessSummary } from "./processes.mjs";
import { getContinuousWorkerStatus, startContinuousWorker } from "./continuousWorker.mjs";
import { getSwarmStatus, startWorkerSwarm } from "./workerSwarm.mjs";
import { getEventArchiveStatus, startEventArchive } from "./eventArchive.mjs";
import { generateSessionReport } from "./sessionReport.mjs";
import {
  dispatchSubscriptionTask,
  listSubscriptionTasks,
  logSubscriptionResult
} from "./subscriptions.mjs";
import { searchCode } from "./codeSearch.mjs";
import { previewProposedCommand } from "./diffPreview.mjs";
import { getActiveDevRuns, listDevChecks, runDevCheck } from "./devTools.mjs";
import { getPerfMetrics } from "./perfMetrics.mjs";
import { getSubagentTree, listSubagents, spawnSubagent, updateSubagent } from "./subagents.mjs";
import { getMemoryConsolidatorStatus, startMemoryConsolidator } from "./memoryConsolidate.mjs";
import { createLocalMessage, getLocalMessages } from "./localMessages.mjs";
import { getPublishStatus } from "./publishStatus.mjs";
import { approveRunRequest, createRunRequest, getRunRequests, rejectRunRequest } from "./runRequests.mjs";
import { attachSseHeartbeat, openSseStream, writeSseEvent } from "./sse.mjs";
import { DEFAULT_PORT, LOCAL_HOST, ROOTS } from "./config.mjs";

const isProduction = process.env.NODE_ENV === "production";

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendError(res, error) {
  sendJson(res, error.status || 500, {
    error: error.message || "Unknown error"
  });
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
    if (Buffer.concat(chunks).byteLength > 256_000) {
      const error = new Error("Request body is too large");
      error.status = 413;
      throw error;
    }
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("Invalid JSON body");
    error.status = 400;
    throw error;
  }
}

function attachHermesStream(res) {
  openSseStream(res);
  attachSseHeartbeat(res);
  const offEvent = subscribeHermesEvents((event) => {
    writeSseEvent(res, "hermes-event", event);
  });
  const offIntent = subscribePublicIntents((intent) => {
    writeSseEvent(res, "public-intent", intent);
  });
  res.on("close", () => {
    offEvent();
    offIntent();
  });
  // initial replay so the client sees recent events even before any new ones
  getHermesEvents(50)
    .then((events) => {
      events
        .slice()
        .reverse()
        .forEach((event) => writeSseEvent(res, "hermes-event", event));
    })
    .catch(() => {});
}

async function apiRoute(req, res) {
  const url = new URL(req.url || "/", `http://${LOCAL_HOST}`);
  if (req.method === "GET" && url.pathname === "/api/status") return sendJson(res, 200, await getStatus());
  if (req.method === "GET" && url.pathname === "/api/review-queues") return sendJson(res, 200, await getReviewQueues());
  if (req.method === "GET" && url.pathname === "/api/projects") return sendJson(res, 200, await getProjects());
  if (req.method === "GET" && url.pathname === "/api/learnings") return sendJson(res, 200, await getLearnings());
  if (req.method === "GET" && url.pathname === "/api/run-requests") return sendJson(res, 200, await getRunRequests());
  if (req.method === "GET" && url.pathname === "/api/changelog") return sendJson(res, 200, await getChangelog());
  if (req.method === "GET" && url.pathname === "/api/improvements") return sendJson(res, 200, await getImprovementEvents());
  if (req.method === "GET" && url.pathname === "/api/publish-status") return sendJson(res, 200, await getPublishStatus());
  if (req.method === "GET" && url.pathname === "/api/local-messages") return sendJson(res, 200, await getLocalMessages());
  if (req.method === "GET" && url.pathname === "/api/design-references") return sendJson(res, 200, await getDesignReferences());
  if (req.method === "GET" && url.pathname === "/api/dashboard") return sendJson(res, 200, await getDashboardPayload());

  if (req.method === "POST" && url.pathname === "/api/local-messages") {
    return sendJson(res, 201, await createLocalMessage(await readJsonBody(req)));
  }

  if (req.method === "POST" && url.pathname === "/api/run-requests") {
    return sendJson(res, 201, await createRunRequest(await readJsonBody(req)));
  }

  const approveMatch = url.pathname.match(/^\/api\/run-requests\/([^/]+)\/approve$/);
  if (req.method === "POST" && approveMatch) {
    return sendJson(res, 200, await approveRunRequest(decodeURIComponent(approveMatch[1])));
  }

  const rejectMatch = url.pathname.match(/^\/api\/run-requests\/([^/]+)\/reject$/);
  if (req.method === "POST" && rejectMatch) {
    const body = await readJsonBody(req);
    return sendJson(res, 200, await rejectRunRequest(decodeURIComponent(rejectMatch[1]), body.reason));
  }

  // Hermes live wires
  if (req.method === "POST" && url.pathname === "/api/hermes/event") {
    const body = await readJsonBody(req);
    const event = await appendHermesEvent(body);
    if (body.sessionId || Number.isFinite(body.iteration)) {
      await recordRuntimeActivity({ sessionId: body.sessionId, iteration: body.iteration });
    }
    return sendJson(res, 201, event);
  }
  if (req.method === "GET" && url.pathname === "/api/hermes/events") {
    const limit = Number(url.searchParams.get("limit") || 200);
    return sendJson(res, 200, await getHermesEvents(Number.isFinite(limit) ? limit : 200));
  }
  if (req.method === "GET" && url.pathname === "/api/hermes/stream") {
    attachHermesStream(res);
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/hermes/run-request") {
    const body = await readJsonBody(req);
    const request = await createRunRequest({ ...body, source: body.source || "hermes" });
    return sendJson(res, 201, request);
  }
  if (req.method === "POST" && url.pathname === "/api/hermes/model") {
    const body = await readJsonBody(req);
    return sendJson(res, 200, await setHermesModel(body.name || body.model));
  }
  if (req.method === "GET" && url.pathname === "/api/hermes/runtime") {
    return sendJson(res, 200, await getHermesRuntime());
  }
  if (req.method === "GET" && url.pathname === "/api/hermes/mission") {
    return sendJson(res, 200, await getMissionState());
  }
  if (req.method === "GET" && url.pathname === "/api/hermes/health") {
    return sendJson(res, 200, await probeSystem());
  }
  if (req.method === "GET" && url.pathname === "/api/hermes/sessions") {
    return sendJson(res, 200, await getHermesSessions());
  }
  if (req.method === "GET" && url.pathname === "/api/hermes/skills") {
    return sendJson(res, 200, await getHermesSkills());
  }
  if (req.method === "GET" && url.pathname === "/api/hermes/memory-files") {
    return sendJson(res, 200, await getMemoryFiles());
  }
  if (req.method === "GET" && url.pathname === "/api/hermes/timeline") {
    const minutes = Number(url.searchParams.get("minutes") || 60);
    return sendJson(res, 200, await getEventTimeline({ minutes: Math.min(Math.max(minutes, 5), 240) }));
  }
  if (req.method === "GET" && url.pathname === "/api/hermes/git") {
    return sendJson(res, 200, await getGitState());
  }
  if (req.method === "POST" && url.pathname === "/api/hermes/proposal") {
    return sendJson(res, 201, await createProposal(await readJsonBody(req)));
  }
  if (req.method === "GET" && url.pathname === "/api/hermes/proposals") {
    return sendJson(res, 200, await getProposals());
  }
  if (req.method === "GET" && url.pathname === "/api/hermes/pending-proposals") {
    return sendJson(res, 200, await getPendingProposals());
  }
  const proposalDecideMatch = url.pathname.match(/^\/api\/hermes\/proposal\/([^/]+)\/(confirm|decline)$/);
  if (req.method === "POST" && proposalDecideMatch) {
    const id = decodeURIComponent(proposalDecideMatch[1]);
    const action = proposalDecideMatch[2];
    const body = await readJsonBody(req);
    const decision = action === "confirm" ? "confirmed" : "declined";
    return sendJson(res, 200, await decideProposal(id, { decision, reason: body.reason }));
  }
  if (req.method === "POST" && url.pathname === "/api/hermes/public-intent") {
    return sendJson(res, 201, await createPublicIntent(await readJsonBody(req)));
  }
  if (req.method === "GET" && url.pathname === "/api/hermes/public-intents") {
    const limit = Number(url.searchParams.get("limit") || 50);
    return sendJson(res, 200, await getPublicIntents(Number.isFinite(limit) ? limit : 50));
  }
  const intentDecideMatch = url.pathname.match(/^\/api\/hermes\/public-intent\/([^/]+)\/(confirm|decline|edit)$/);
  if (req.method === "POST" && intentDecideMatch) {
    const id = decodeURIComponent(intentDecideMatch[1]);
    const action = intentDecideMatch[2];
    const body = await readJsonBody(req);
    const decision = action === "confirm" ? "confirmed" : action === "decline" ? "declined" : "edited";
    return sendJson(res, 200, await decidePublicIntent(id, { decision, content: body.content, reason: body.reason }));
  }
  if (req.method === "GET" && url.pathname === "/api/hermes/pending-intents") {
    return sendJson(res, 200, await getPendingPublicIntents());
  }
  if (req.method === "POST" && url.pathname === "/api/runtime/auto-approve") {
    const body = await readJsonBody(req);
    return sendJson(res, 200, await setAutoApprove(Boolean(body.value ?? body.enabled ?? true)));
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, at: new Date().toISOString() });
  }
  if (req.method === "GET" && url.pathname === "/api/hermes/cadence") {
    const cadence = await getCadence();
    void noteCadenceTransition({ mode: cadence.mode });
    return sendJson(res, 200, cadence);
  }
  if (req.method === "GET" && url.pathname === "/api/hermes/auto-apply-status") {
    return sendJson(res, 200, getAutoApplyStatus());
  }
  if (req.method === "GET" && url.pathname === "/api/hermes/morning-brief") {
    const force = url.searchParams.get("force") === "true";
    return sendJson(res, 200, await getMorningBrief({ force }));
  }

  if (req.method === "GET" && url.pathname === "/api/obsidian/vault") {
    return sendJson(res, 200, await walkVault({ depth: Number(url.searchParams.get("depth") || 4) }));
  }
  if (req.method === "GET" && url.pathname === "/api/obsidian/note") {
    const p = url.searchParams.get("path");
    if (!p) return sendJson(res, 400, { error: "path required" });
    return sendJson(res, 200, await readNote(p));
  }
  if (req.method === "POST" && url.pathname === "/api/obsidian/note") {
    return sendJson(res, 201, await writeNote(await readJsonBody(req)));
  }
  if (req.method === "GET" && url.pathname === "/api/obsidian/graph") {
    return sendJson(res, 200, await linkGraph());
  }

  if (req.method === "GET" && url.pathname === "/api/hermes/tasks") {
    const mission = url.searchParams.get("mission") || undefined;
    const status = url.searchParams.get("status") || undefined;
    return sendJson(res, 200, await listTasks({ mission, status }));
  }
  if (req.method === "POST" && url.pathname === "/api/hermes/tasks") {
    return sendJson(res, 201, await addTask(await readJsonBody(req)));
  }
  const taskUpdateMatch = url.pathname.match(/^\/api\/hermes\/tasks\/([^/]+)$/);
  if (req.method === "PATCH" && taskUpdateMatch) {
    return sendJson(res, 200, await updateTask(decodeURIComponent(taskUpdateMatch[1]), await readJsonBody(req)));
  }

  if (req.method === "POST" && url.pathname === "/api/hermes/plan") {
    return sendJson(res, 201, await createPlan(await readJsonBody(req)));
  }
  if (req.method === "GET" && url.pathname === "/api/hermes/plans") {
    return sendJson(res, 200, await listPlans(Number(url.searchParams.get("limit") || 30)));
  }
  const planStepMatch = url.pathname.match(/^\/api\/hermes\/plan\/([^/]+)\/step\/(\d+)$/);
  if (req.method === "POST" && planStepMatch) {
    const id = decodeURIComponent(planStepMatch[1]);
    const idx = Number(planStepMatch[2]);
    return sendJson(res, 200, await recordStepResult(id, idx, await readJsonBody(req)));
  }
  const planMatch = url.pathname.match(/^\/api\/hermes\/plan\/([^/]+)$/);
  if (req.method === "GET" && planMatch) {
    const plan = await getPlan(decodeURIComponent(planMatch[1]));
    if (!plan) return sendJson(res, 404, { error: "unknown plan" });
    return sendJson(res, 200, plan);
  }
  if (req.method === "POST" && url.pathname === "/api/hermes/reflect") {
    const body = await readJsonBody(req);
    return sendJson(res, 200, await reflect(body.planId, body.learning));
  }

  const themedMatch = url.pathname.match(/^\/api\/themed\/([a-z_]+)$/);
  if (themedMatch) {
    const surface = themedMatch[1];
    if (!THEMED_SURFACES.includes(surface)) return sendJson(res, 404, { error: "unknown surface" });
    if (req.method === "POST") {
      return sendJson(res, 201, await postThemedItem(surface, await readJsonBody(req)));
    }
    if (req.method === "GET") {
      return sendJson(res, 200, await getThemedItems(surface, Number(url.searchParams.get("limit") || 20)));
    }
  }

  if (req.method === "POST" && url.pathname === "/api/telegram/send") {
    const body = await readJsonBody(req);
    return sendJson(res, 200, await sendTelegramMessage({ text: body.text, urgent: Boolean(body.urgent) }));
  }
  if (req.method === "POST" && url.pathname === "/api/runtime/telegram-send") {
    const body = await readJsonBody(req);
    const next = setOutboundEnabled(Boolean(body.value ?? body.enabled ?? true));
    return sendJson(res, 200, { enabled: next });
  }
  if (req.method === "GET" && url.pathname === "/api/telegram/status") {
    return sendJson(res, 200, getOutboundStatus());
  }
  if (req.method === "GET" && url.pathname === "/api/hermes/ollama-warm") {
    return sendJson(res, 200, getOllamaWarmStatus());
  }

  if (req.method === "GET" && url.pathname === "/api/dashboard-layout") {
    return sendJson(res, 200, await getLayout());
  }
  if (req.method === "POST" && url.pathname === "/api/dashboard-layout") {
    return sendJson(res, 200, await updateLayout(await readJsonBody(req)));
  }
  if (req.method === "DELETE" && url.pathname === "/api/dashboard-layout") {
    return sendJson(res, 200, await resetLayout());
  }

  if (req.method === "GET" && url.pathname === "/api/hermes/processes") {
    return sendJson(res, 200, await getProcessSummary());
  }
  if (req.method === "GET" && url.pathname === "/api/hermes/worker") {
    return sendJson(res, 200, getContinuousWorkerStatus());
  }
  if (req.method === "GET" && url.pathname === "/api/hermes/swarm") {
    return sendJson(res, 200, getSwarmStatus());
  }
  if (req.method === "GET" && url.pathname === "/api/hermes/event-archive") {
    return sendJson(res, 200, getEventArchiveStatus());
  }
  if (req.method === "GET" && url.pathname === "/api/hermes/session-report") {
    const minutes = Number(url.searchParams.get("minutes") || 60);
    return sendJson(res, 200, await generateSessionReport({ minutes: Math.min(Math.max(minutes, 5), 720) }));
  }

  if (req.method === "POST" && url.pathname === "/api/hermes/subscriptions") {
    return sendJson(res, 201, await dispatchSubscriptionTask(await readJsonBody(req)));
  }
  if (req.method === "GET" && url.pathname === "/api/hermes/subscriptions") {
    const provider = url.searchParams.get("provider") || undefined;
    const status = url.searchParams.get("status") || undefined;
    return sendJson(res, 200, await listSubscriptionTasks({ provider, status }));
  }
  const subUpdate = url.pathname.match(/^\/api\/hermes\/subscriptions\/([^/]+)$/);
  if (req.method === "PATCH" && subUpdate) {
    return sendJson(res, 200, await logSubscriptionResult(decodeURIComponent(subUpdate[1]), await readJsonBody(req)));
  }

  if (req.method === "POST" && url.pathname === "/api/code/search") {
    const body = await readJsonBody(req);
    return sendJson(res, 200, await searchCode(body));
  }
  if (req.method === "POST" && url.pathname === "/api/code/diff-preview") {
    const body = await readJsonBody(req);
    return sendJson(res, 200, await previewProposedCommand(body));
  }
  if (req.method === "POST" && url.pathname === "/api/dev/run") {
    const body = await readJsonBody(req);
    return sendJson(res, 200, await runDevCheck(body.name || "check"));
  }
  if (req.method === "GET" && url.pathname === "/api/dev/checks") {
    return sendJson(res, 200, { available: listDevChecks(), active: getActiveDevRuns() });
  }
  if (req.method === "GET" && url.pathname === "/api/hermes/perf") {
    const probeSpeed = url.searchParams.get("speed") === "true";
    return sendJson(res, 200, await getPerfMetrics({ probeSpeed }));
  }
  if (req.method === "GET" && url.pathname === "/api/hermes/subagents") {
    const parentId = url.searchParams.get("parentId") || null;
    return sendJson(res, 200, await listSubagents({ parentId }));
  }
  if (req.method === "GET" && url.pathname === "/api/hermes/subagents/tree") {
    return sendJson(res, 200, await getSubagentTree());
  }
  if (req.method === "POST" && url.pathname === "/api/hermes/subagents") {
    return sendJson(res, 201, await spawnSubagent(await readJsonBody(req)));
  }
  const subUpdateMatch = url.pathname.match(/^\/api\/hermes\/subagents\/([^/]+)$/);
  if (req.method === "PATCH" && subUpdateMatch) {
    return sendJson(res, 200, await updateSubagent(decodeURIComponent(subUpdateMatch[1]), await readJsonBody(req)));
  }
  if (req.method === "GET" && url.pathname === "/api/hermes/memory-consolidator") {
    return sendJson(res, 200, getMemoryConsolidatorStatus());
  }

  return false;
}

async function createRequestHandler() {
  if (!isProduction) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: {
          host: LOCAL_HOST
        }
      },
      appType: "spa",
      root: ROOTS.project
    });
    return async (req, res) => {
      try {
        const handled = await apiRoute(req, res);
        if (handled !== false) return;
        vite.middlewares(req, res);
      } catch (error) {
        sendError(res, error);
      }
    };
  }

  const dist = path.join(ROOTS.project, "dist");
  return async (req, res) => {
    try {
      const handled = await apiRoute(req, res);
      if (handled !== false) return;
      const url = new URL(req.url || "/", `http://${LOCAL_HOST}`);
      const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const filePath = path.resolve(dist, requested);
      if (!filePath.startsWith(dist)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      const body = await fs.readFile(filePath).catch(() => fs.readFile(path.join(dist, "index.html")));
      res.writeHead(200);
      res.end(body);
    } catch (error) {
      sendError(res, error);
    }
  };
}

if (process.env.HOST && process.env.HOST !== LOCAL_HOST && process.env.HOST !== "localhost") {
  throw new Error("Refusing to bind Pretext Mission Control outside localhost for V1.");
}

const handler = await createRequestHandler();
const server = http.createServer(handler);

server.listen(DEFAULT_PORT, LOCAL_HOST, () => {
  console.log(`Hermes Mission Control running at http://${LOCAL_HOST}:${DEFAULT_PORT}`);
  startBuilderLoop();
  startImprovementLoop({ getDashboard: getDashboardPayload });
  startObsidianLogger();
  startObsidianWatcher();
  startAutoApplyLoop();
  startOllamaWarm();
  startMemoryConsolidator();
  // Disable the old single-worker and run the parallel swarm instead.
  if (process.env.PRETEXT_LEGACY_WORKER === "true") startContinuousWorker();
  startWorkerSwarm();
  startEventArchive();

  // Auto-generate an hourly session report on the hour, mirroring to the vault
  // so each hour is reviewable in Obsidian even if the dashboard is closed.
  const scheduleHourly = () => {
    const now = new Date();
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    next.setHours(now.getHours() + 1);
    const delay = next.getTime() - now.getTime();
    setTimeout(async () => {
      try {
        await generateSessionReport({ minutes: 60 });
      } catch {
        // best-effort
      }
      scheduleHourly();
    }, delay);
  };
  scheduleHourly();
});
