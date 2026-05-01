// Pipeline orchestrator: replaces the 'spray' executor + selfimprove workers
// with one chained worker that runs the FULL shipping pipeline on the top
// open task each tick:
//   pickTask → searchPhase (LLM) → playbookPhase (LLM) → previewPhase
//   → submitPhase → closePhase
//
// Each phase is grounded in the previous step's output. Failure modes surface
// cleanly per-phase so the next tick can either retry or abandon. The tick
// emits pipeline_step events so the dashboard sees the chain run.

import { appendHermesEvent } from "./hermesEvents.mjs";
import { listTasks, updateTask } from "./taskLedger.mjs";
import { searchCode } from "./codeSearch.mjs";
import { listPlaybooks } from "./playbookLoader.mjs";
import { createProposal } from "./proposals.mjs";
import { getSharedContext, formatSharedContextBlock } from "./swarmContext.mjs";
import { safeSnippet } from "./redaction.mjs";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const PIPELINE_MODEL = process.env.PRETEXT_PIPELINE_MODEL || "gemma4:e4b";
const TICK_MS = Number(process.env.PRETEXT_PIPELINE_TICK_MS || 90_000);
const ATTEMPT_COOLDOWN_MS = 5 * 60_000;

let timer = null;
let inFlight = false;
let totalTicks = 0;
let totalShipped = 0;
let lastTickAt = null;
let lastResult = "boot";
const taskAttempts = new Map(); // taskId -> { lastAt: ms, attempts: n }

async function callOllama({ system, user, model = PIPELINE_MODEL }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        keep_alive: "24h",
        stream: false,
        format: "json",
        think: false,
        options: { temperature: 0.3, num_predict: 800, num_ctx: 4096, top_p: 0.9 },
        messages: [
          { role: "system", content: `${system}\n\nReply with ONE valid JSON object only. No markdown, no preamble.` },
          { role: "user", content: user }
        ]
      }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`ollama ${res.status}`);
    const data = await res.json();
    const text = data.message?.content || data.message?.thinking || "";
    let parsed = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch { parsed = {}; }
      }
    }
    return { parsed, raw: text };
  } finally {
    clearTimeout(timeout);
  }
}

async function emit(phase, content, sessionId, extra) {
  await appendHermesEvent({
    type: "pipeline_step",
    role: "system",
    content: `[${phase}] ${safeSnippet(content, 240)}`,
    sessionId,
    extra
  });
}

async function pickTask() {
  const open = await listTasks({ status: "open" });
  if (!open.length) return null;
  // Sort by age (oldest first) so we don't starve old tasks. Skip tasks we
  // tried recently within the cooldown window.
  const now = Date.now();
  const sorted = open.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  for (const task of sorted) {
    const rec = taskAttempts.get(task.id);
    if (rec && now - rec.lastAt < ATTEMPT_COOLDOWN_MS) continue;
    return task;
  }
  return null;
}

async function searchPhase({ task, sessionId, sharedBlock }) {
  const system =
    "You are the SEARCH phase of a coding pipeline. " +
    "Given a task title, output a search pattern + file glob to locate the relevant code. " +
    'Return JSON: {"thinking": "<one sentence>", "search_pattern": "<rg pattern, ≤ 80 chars>", "file_glob": "<glob like src/**/*.tsx>"}.';
  const user = `${sharedBlock}\n\nTask:\n${task.mission}: ${task.title}\n\nWhat code should we search for?`;
  await appendHermesEvent({ type: "model_call", role: "assistant", content: `[pipeline:search] ${task.id}`, sessionId, model: PIPELINE_MODEL });
  const { parsed } = await callOllama({ system, user });
  const pattern = parsed.search_pattern || "";
  const glob = parsed.file_glob || "src/**/*.tsx";
  if (parsed.thinking) {
    await appendHermesEvent({ type: "thinking", role: "assistant", content: `[pipeline:search] ${parsed.thinking}`, sessionId, model: PIPELINE_MODEL });
  }
  if (!pattern) return { ok: false, reason: "model returned no search_pattern" };
  let results;
  try {
    results = await searchCode({ pattern, fileGlob: glob, maxResults: 6 });
  } catch (error) {
    return { ok: false, reason: `search failed: ${error?.message}` };
  }
  await emit("search", `pattern="${pattern}" matches=${results.matches.length}`, sessionId);
  return { ok: true, pattern, glob, matches: results.matches };
}

async function playbookPhase({ task, search, sessionId, sharedBlock }) {
  const playbooks = await listPlaybooks();
  if (!playbooks.length) return { ok: false, reason: "no playbooks loaded" };
  const list = playbooks
    .map((p) => `- ${p.id}: ${p.title} — ${p.description}`)
    .join("\n");
  const matchSnippets = search.matches
    .slice(0, 4)
    .map((m) => `${m.file}:${m.line}: ${m.snippet}`)
    .join("\n");
  const system =
    "You are the PLAYBOOK phase. Pick a playbook id and fill in concrete edit fields based on the task and the code matches. " +
    'Return JSON: {"thinking": "<one sentence>", "playbook_id": "<id>", "filePath": "<file from matches>", "find": "<exact substring to replace, must be unique in file>", "replace": "<replacement>", "rationale": "<≤ 120 chars>"}. ' +
    "Constraints: filePath must be one of the matched files. find must be a verbatim substring (≥ 8 chars), unique in the file. If you can't satisfy these, return playbook_id=null.";
  const user = `${sharedBlock}\n\nTask:\n${task.mission}: ${task.title}\n\nAvailable playbooks:\n${list}\n\nCode matches:\n${matchSnippets || "(none — try a different search next tick)"}\n\nProduce the edit.`;
  await appendHermesEvent({ type: "model_call", role: "assistant", content: `[pipeline:playbook] ${task.id}`, sessionId, model: PIPELINE_MODEL });
  const { parsed } = await callOllama({ system, user });
  if (parsed.thinking) {
    await appendHermesEvent({ type: "thinking", role: "assistant", content: `[pipeline:playbook] ${parsed.thinking}`, sessionId, model: PIPELINE_MODEL });
  }
  if (!parsed.playbook_id) return { ok: false, reason: "model declined to pick a playbook" };
  if (!parsed.filePath || !parsed.find || typeof parsed.replace !== "string") {
    return { ok: false, reason: "model returned incomplete edit" };
  }
  if (parsed.find === parsed.replace) return { ok: false, reason: "find equals replace (no-op)" };
  await emit("playbook", `${parsed.playbook_id} → ${parsed.filePath}`, sessionId, { playbook: parsed.playbook_id });
  return {
    ok: true,
    playbookId: parsed.playbook_id,
    filePath: parsed.filePath,
    find: parsed.find,
    replace: parsed.replace,
    rationale: parsed.rationale || `pipeline ${parsed.playbook_id}`
  };
}

async function submitPhase({ task, edit, sessionId }) {
  // createProposal will call previewProposedEdit internally via the validator
  // and reject if no real diff. autoSafe:true → auto-apply loop will pick it up.
  const proposal = await createProposal({
    kind: "edit",
    title: safeSnippet(task.title, 160),
    rationale: safeSnippet(edit.rationale, 400),
    filePath: edit.filePath,
    find: edit.find,
    replace: edit.replace,
    playbookId: edit.playbookId,
    autoSafe: true,
    sessionId
  });
  await emit("submit", `${proposal.id} ${proposal.status}`, sessionId, { proposalId: proposal.id });
  return { ok: proposal.status !== "rejected", proposal };
}

async function runPipelineTick() {
  if (inFlight) return;
  inFlight = true;
  totalTicks += 1;
  lastTickAt = new Date().toISOString();
  try {
    const task = await pickTask();
    if (!task) {
      lastResult = "no eligible tasks";
      return;
    }
    const sessionId = `pipeline_${task.id}`;
    taskAttempts.set(task.id, { lastAt: Date.now(), attempts: (taskAttempts.get(task.id)?.attempts || 0) + 1 });

    const sharedCtx = await getSharedContext();
    const sharedBlock = formatSharedContextBlock(sharedCtx);

    await emit("pickTask", `${task.id} [${task.mission}] ${task.title}`, sessionId);

    const search = await searchPhase({ task, sessionId, sharedBlock });
    if (!search.ok) {
      await emit("abandon", `search: ${search.reason}`, sessionId);
      lastResult = `search failed: ${search.reason}`;
      return;
    }

    const edit = await playbookPhase({ task, search, sessionId, sharedBlock });
    if (!edit.ok) {
      await emit("abandon", `playbook: ${edit.reason}`, sessionId);
      lastResult = `playbook failed: ${edit.reason}`;
      return;
    }

    const submit = await submitPhase({ task, edit, sessionId });
    if (!submit.ok) {
      await emit("abandon", `submit: ${submit.proposal.declineReason || submit.proposal.status}`, sessionId);
      await updateTask(task.id, { note: `pipeline rejected: ${safeSnippet(submit.proposal.declineReason || "", 200)}` });
      lastResult = `submit rejected: ${safeSnippet(submit.proposal.declineReason || "", 80)}`;
      return;
    }

    // The auto-apply loop will pick the proposal up within 10s. The closer
    // worker (in workerSwarm) will mark the task done once a commit lands
    // matching the title. We just record the submission here.
    await updateTask(task.id, { note: `pipeline submitted proposal ${submit.proposal.id}` });
    totalShipped += 1;
    lastResult = `submitted ${submit.proposal.id}`;
  } catch (error) {
    lastResult = `tick error: ${error?.message || "unknown"}`;
    await appendHermesEvent({
      type: "error",
      role: "system",
      content: `[pipeline] ${lastResult}`
    }).catch(() => {});
  } finally {
    inFlight = false;
  }
}

export function startPipelineWorker() {
  if (timer) return timer;
  if (process.env.PRETEXT_PIPELINE === "false") return null;
  // First tick at 20s to let other boot tasks settle.
  setTimeout(() => void runPipelineTick(), 20_000);
  timer = setInterval(() => void runPipelineTick(), TICK_MS);
  timer.unref?.();
  return timer;
}

export function getPipelineStatus() {
  return {
    state: timer ? "running" : "stopped",
    intervalMs: TICK_MS,
    model: PIPELINE_MODEL,
    totalTicks,
    totalShipped,
    lastTickAt,
    lastResult
  };
}
