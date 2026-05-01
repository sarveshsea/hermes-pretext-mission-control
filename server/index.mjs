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
});
