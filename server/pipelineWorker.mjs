// Pipeline orchestrator. Runs a chained shipping pipeline on the top open
// task each tick:
//
//   pickTask → concretizePhase → searchPhase → playbookPhase
//            → previewPhase → submitPhase → closePhase
//
// Each phase is a narrow LLM call (or no-LLM step) that grounds itself in the
// previous step's output PLUS a real codebase index PLUS past-outcome
// few-shots from the pipeline journal. Multi-model routing puts the smart
// model on the hardest phases. Tick state on tasks lets a hard task resume
// from its failing phase across multiple ticks.

import { appendHermesEvent } from "./hermesEvents.mjs";
import { listTasks, updateTask } from "./taskLedger.mjs";
import { searchCode } from "./codeSearch.mjs";
import { listPlaybooks } from "./playbookLoader.mjs";
import { rankedPlaybooks, recordOutcome } from "./playbookStats.mjs";
import { createProposal } from "./proposals.mjs";
import { getSharedContext, formatSharedContextBlock } from "./swarmContext.mjs";
import { getCodeIndex, renderIndexBlock } from "./codeIndex.mjs";
import { appendJournal, formatJournalForPrompt, readJournalTail } from "./pipelineJournal.mjs";
import { safeSnippet } from "./redaction.mjs";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
// Phase-specific models: cheap for pickTask/search, smart for concretize/playbook.
const SEARCH_MODEL = process.env.PRETEXT_PIPELINE_SEARCH_MODEL || "gemma4:e4b";
const CONCRETIZE_MODEL = process.env.PRETEXT_PIPELINE_CONCRETIZE_MODEL || "gpt-oss:20b";
const PLAYBOOK_MODEL = process.env.PRETEXT_PIPELINE_PLAYBOOK_MODEL || "gpt-oss:20b";
const TICK_MS = Number(process.env.PRETEXT_PIPELINE_TICK_MS || 90_000);
const ATTEMPT_COOLDOWN_MS = 5 * 60_000;
const MIN_INTERVAL_MS = 15_000;
const MAX_INTERVAL_MS = 10 * 60_000;

let timer = null;
let inFlight = false;
let totalTicks = 0;
let totalShipped = 0;
let lastTickAt = null;
let lastResult = "boot";
let currentInterval = TICK_MS;
const recentOutcomes = []; // ["ship", "ship", "abandon"] (cap 6)
const taskAttempts = new Map(); // taskId -> { lastAt: ms, attempts: n }

async function callOllama({ system, user, model }) {
  const controller = new AbortController();
  // gpt-oss:20b can take 60-120s on cold load and 20-40s warm. 240s gives
  // headroom for cold start + slow generation.
  const timeoutMs = /20b|13b|llama3.1:8b/.test(model) ? 240_000 : 90_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
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
        options: { temperature: 0.3, num_predict: 1000, num_ctx: 8192, top_p: 0.9 },
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
    return { parsed, raw: text, latencyMs: Date.now() - start, model };
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

// Track outcome for adaptive cadence. After 3 consecutive ships → halve
// interval; after 3 abandons → double.
function recordCadenceOutcome(kind) {
  recentOutcomes.push(kind);
  if (recentOutcomes.length > 6) recentOutcomes.shift();
  const last3 = recentOutcomes.slice(-3);
  if (last3.length === 3 && last3.every((o) => o === "ship")) {
    currentInterval = Math.max(MIN_INTERVAL_MS, Math.floor(currentInterval / 2));
  } else if (last3.length === 3 && last3.every((o) => o === "abandon")) {
    currentInterval = Math.min(MAX_INTERVAL_MS, currentInterval * 2);
  }
}

async function pickTask() {
  const open = await listTasks({ status: "open" });
  if (!open.length) return null;
  const now = Date.now();

  // 1) Prefer tasks already in mid-pipeline (have pipelineState) — resume
  //    them before picking fresh work. This is what makes ticks compound.
  const inProgress = open
    .filter((t) => t.pipelineState && t.pipelineState.phase && t.pipelineState.phase !== "abandoned")
    .sort((a, b) => new Date(a.pipelineState.updatedAt || a.updatedAt) - new Date(b.pipelineState.updatedAt || b.updatedAt));
  for (const task of inProgress) {
    const rec = taskAttempts.get(task.id);
    if (rec && now - rec.lastAt < ATTEMPT_COOLDOWN_MS) continue;
    return task;
  }

  // 2) Otherwise: oldest concrete task (skip ones tagged needs_design).
  const sorted = open
    .filter((t) => !(t.tags || []).includes("needs_design"))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  for (const task of sorted) {
    const rec = taskAttempts.get(task.id);
    if (rec && now - rec.lastAt < ATTEMPT_COOLDOWN_MS) continue;
    return task;
  }
  return null;
}

// Concretize: given an abstract task, output {component, file_path, target_change}
// or {needs_design: true}. Skipped if pipelineState already has a concretize result.
async function concretizePhase({ task, sessionId, sharedBlock, indexBlock }) {
  if (task.pipelineState?.concretize) {
    return { ok: true, ...task.pipelineState.concretize, fromCache: true };
  }
  const system =
    "You are the CONCRETIZE phase of a coding pipeline. " +
    "Given an abstract task and a real codebase index, output a concrete edit target. " +
    'Return JSON: {"thinking": "<one sentence>", "component": "<existing React component name OR null>", "file_path": "<relative path that exists in the index OR null>", "target_change": "<one-line description of the concrete change to make>", "needs_design": <true if this task is too abstract to map to code>}. ' +
    "Constraints: file_path MUST be one of the listed Files. component MUST be one of the listed Components. If neither fits, set needs_design=true.";
  const user = `${sharedBlock}\n\n${indexBlock}\n\nTask:\n${task.mission}: ${task.title}\n\nMap this task to a real file + change. Or declare it needs_design.`;
  await appendHermesEvent({ type: "model_call", role: "assistant", content: `[pipeline:concretize] ${task.id}`, sessionId, model: CONCRETIZE_MODEL });
  const { parsed, latencyMs, raw } = await callOllama({ system, user, model: CONCRETIZE_MODEL });
  if (parsed.thinking) {
    await appendHermesEvent({ type: "thinking", role: "assistant", content: `[pipeline:concretize] ${parsed.thinking}`, sessionId, model: CONCRETIZE_MODEL });
  }
  if (parsed.needs_design === true) {
    await emit("concretize", `needs_design — ${task.title}`, sessionId, { latencyMs, model: CONCRETIZE_MODEL });
    return { ok: false, needs_design: true, reason: "task too abstract" };
  }
  if (!parsed.file_path || typeof parsed.target_change !== "string") {
    return { ok: false, reason: `concretize returned incomplete: ${safeSnippet(raw, 80)}` };
  }
  await emit("concretize", `${parsed.file_path} ← ${safeSnippet(parsed.target_change, 80)}`, sessionId, { latencyMs, model: CONCRETIZE_MODEL });
  return {
    ok: true,
    component: parsed.component || null,
    file_path: parsed.file_path,
    target_change: parsed.target_change
  };
}

async function searchPhase({ task, concretize, sessionId, sharedBlock, indexBlock }) {
  // If we already have search results cached, reuse them.
  if (task.pipelineState?.search?.matches?.length) {
    await emit("search", `cached matches=${task.pipelineState.search.matches.length}`, sessionId);
    return { ok: true, ...task.pipelineState.search };
  }
  const system =
    "You are the SEARCH phase. Output a search pattern + glob targeted at the concrete file. " +
    'Return JSON: {"thinking": "<one sentence>", "search_pattern": "<rg pattern, ≤ 80 chars, must be a string LITERALLY present in the target file>", "file_glob": "<glob>"}.';
  const user =
    `${sharedBlock}\n\n${indexBlock}\n\n` +
    `Task: ${task.title}\nConcrete target: ${concretize.file_path} (${concretize.target_change})\n\n` +
    `Pick a substring that is verbatim present in ${concretize.file_path}. Prefer specific identifiers (className, component name, function name) over generic words.`;
  await appendHermesEvent({ type: "model_call", role: "assistant", content: `[pipeline:search] ${task.id}`, sessionId, model: SEARCH_MODEL });
  const { parsed, latencyMs } = await callOllama({ system, user, model: SEARCH_MODEL });
  const pattern = parsed.search_pattern || "";
  const glob = parsed.file_glob || concretize.file_path;
  if (parsed.thinking) {
    await appendHermesEvent({ type: "thinking", role: "assistant", content: `[pipeline:search] ${parsed.thinking}`, sessionId, model: SEARCH_MODEL });
  }
  if (!pattern) return { ok: false, reason: "search returned no pattern" };
  let results;
  try {
    results = await searchCode({ pattern, fileGlob: glob, maxResults: 6 });
  } catch (error) {
    return { ok: false, reason: `searchCode failed: ${error?.message}` };
  }
  await emit("search", `pattern="${pattern}" matches=${results.matches.length}`, sessionId, { latencyMs, model: SEARCH_MODEL });
  if (!results.matches.length) return { ok: false, reason: `0 matches for "${pattern}" in ${glob}` };
  return { ok: true, pattern, glob, matches: results.matches };
}

async function playbookPhase({ task, concretize, search, sessionId, sharedBlock, indexBlock, journalBlock }) {
  const playbooks = await listPlaybooks();
  if (!playbooks.length) return { ok: false, reason: "no playbooks loaded" };
  const ranked = await rankedPlaybooks(playbooks.map((p) => p.id));
  const orderedIds = ranked.map((r) => r.id);
  const orderedPlaybooks = orderedIds.map((id) => playbooks.find((p) => p.id === id)).filter(Boolean);
  const list = orderedPlaybooks
    .map((p) => {
      const stat = ranked.find((r) => r.id === p.id);
      const tag = stat.untested ? "[new]" : `[${stat.success}/${stat.success + stat.fail}]`;
      return `- ${p.id} ${tag}: ${p.title} — ${p.description}`;
    })
    .join("\n");
  const matchSnippets = search.matches
    .slice(0, 4)
    .map((m) => `${m.file}:${m.line}: ${m.snippet}`)
    .join("\n");
  const system =
    "You are the PLAYBOOK phase. Pick a playbook id and fill in concrete edit fields. " +
    'Return JSON: {"thinking": "<one sentence>", "playbook_id": "<id>", "filePath": "<file from matches, must be the concretize target>", "find": "<exact substring to replace, ≥ 12 chars, must be UNIQUE in the file and present in the matches>", "replace": "<replacement>", "rationale": "<≤ 120 chars>"}. ' +
    "Constraints: filePath must equal the concretize target. find must be a verbatim substring from the matches snippets, ≥ 12 chars. find ≠ replace (must produce a real diff). If you can't satisfy these, set playbook_id=null.";
  const user =
    `${sharedBlock}\n\n${journalBlock}\n\n` +
    `Task: ${task.title}\nTarget file: ${concretize.file_path}\nIntended change: ${concretize.target_change}\n\n` +
    `Playbooks (sorted by past success):\n${list}\n\nMatches in target file:\n${matchSnippets}\n\nProduce the edit.`;
  await appendHermesEvent({ type: "model_call", role: "assistant", content: `[pipeline:playbook] ${task.id}`, sessionId, model: PLAYBOOK_MODEL });
  const { parsed, latencyMs, raw } = await callOllama({ system, user, model: PLAYBOOK_MODEL });
  if (parsed.thinking) {
    await appendHermesEvent({ type: "thinking", role: "assistant", content: `[pipeline:playbook] ${parsed.thinking}`, sessionId, model: PLAYBOOK_MODEL });
  }
  if (!parsed.playbook_id) return { ok: false, reason: "model declined to pick a playbook" };
  if (!parsed.filePath || !parsed.find || typeof parsed.replace !== "string") {
    return { ok: false, reason: `incomplete edit: ${safeSnippet(raw, 100)}` };
  }
  if (parsed.find === parsed.replace) return { ok: false, reason: "find equals replace (no-op)" };
  if (parsed.find.length < 8) return { ok: false, reason: "find too short (must be ≥ 8 chars to be unique)" };
  await emit("playbook", `${parsed.playbook_id} → ${parsed.filePath}`, sessionId, { playbook: parsed.playbook_id, latencyMs, model: PLAYBOOK_MODEL });
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
  // Fire a thinking event so the validator's 60s window is satisfied.
  await appendHermesEvent({
    type: "thinking",
    role: "assistant",
    content: `[pipeline:submit] proposing ${edit.playbookId} edit to ${edit.filePath}`,
    sessionId
  });
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
  let outcome = "abandon";
  let pipelineRecord = { tick: totalTicks, ts: lastTickAt };
  try {
    const task = await pickTask();
    if (!task) {
      lastResult = "no eligible tasks";
      outcome = "idle";
      return;
    }
    const sessionId = `pipeline_${task.id}`;
    taskAttempts.set(task.id, { lastAt: Date.now(), attempts: (taskAttempts.get(task.id)?.attempts || 0) + 1 });
    pipelineRecord.taskId = task.id;
    pipelineRecord.taskTitle = task.title;

    const [sharedCtx, codeIndex, journalEntries] = await Promise.all([
      getSharedContext(),
      getCodeIndex(),
      readJournalTail(20)
    ]);
    const sharedBlock = formatSharedContextBlock(sharedCtx);
    const indexBlock = renderIndexBlock(codeIndex, { mission: task.mission });
    const journalBlock = formatJournalForPrompt(journalEntries);

    await emit("pickTask", `${task.id} [${task.mission}] ${task.title}`, sessionId);

    // Concretize phase (skipped if cached on task.pipelineState).
    const concretize = await concretizePhase({ task, sessionId, sharedBlock, indexBlock });
    if (!concretize.ok) {
      if (concretize.needs_design) {
        await updateTask(task.id, {
          tags: [...(task.tags || []), "needs_design"],
          note: "concretize: needs_design",
          pipelineState: { phase: "abandoned", reason: "needs_design", updatedAt: new Date().toISOString() }
        });
        pipelineRecord.phase = "concretize";
        pipelineRecord.outcome = "needs_design";
        await emit("abandon", `concretize: needs_design`, sessionId);
        lastResult = "needs_design";
        return;
      }
      await emit("abandon", `concretize: ${concretize.reason}`, sessionId);
      pipelineRecord.phase = "concretize";
      pipelineRecord.outcome = "abandon";
      pipelineRecord.reason = concretize.reason;
      lastResult = `concretize failed: ${concretize.reason}`;
      return;
    }

    // Search phase (skipped if cached).
    const search = await searchPhase({ task, concretize, sessionId, sharedBlock, indexBlock });
    if (!search.ok) {
      // Persist the partial state so next tick resumes from search instead of redoing concretize.
      await updateTask(task.id, {
        pipelineState: { phase: "search", concretize, attempts: (task.pipelineState?.attempts || 0) + 1, lastError: search.reason, updatedAt: new Date().toISOString() }
      });
      pipelineRecord.phase = "search";
      pipelineRecord.outcome = "abandon";
      pipelineRecord.reason = search.reason;
      pipelineRecord.filePath = concretize.file_path;
      await emit("abandon", `search: ${search.reason}`, sessionId);
      lastResult = `search failed: ${search.reason}`;
      return;
    }

    // Playbook phase.
    const edit = await playbookPhase({ task, concretize, search, sessionId, sharedBlock, indexBlock, journalBlock });
    if (!edit.ok) {
      await updateTask(task.id, {
        pipelineState: { phase: "playbook", concretize, search, attempts: (task.pipelineState?.attempts || 0) + 1, lastError: edit.reason, updatedAt: new Date().toISOString() }
      });
      pipelineRecord.phase = "playbook";
      pipelineRecord.outcome = "abandon";
      pipelineRecord.reason = edit.reason;
      pipelineRecord.filePath = concretize.file_path;
      await emit("abandon", `playbook: ${edit.reason}`, sessionId);
      lastResult = `playbook: ${edit.reason}`;
      return;
    }

    // Submit phase.
    const submit = await submitPhase({ task, edit, sessionId });
    pipelineRecord.phase = "submit";
    pipelineRecord.playbook = edit.playbookId;
    pipelineRecord.filePath = edit.filePath;
    if (!submit.ok) {
      await updateTask(task.id, {
        pipelineState: { phase: "playbook", concretize, search, attempts: (task.pipelineState?.attempts || 0) + 1, lastError: submit.proposal.declineReason, updatedAt: new Date().toISOString() },
        note: `pipeline rejected: ${safeSnippet(submit.proposal.declineReason || "", 200)}`
      });
      await recordOutcome(edit.playbookId, { outcome: "rejected", reason: submit.proposal.declineReason || "rejected" });
      pipelineRecord.outcome = "abandon";
      pipelineRecord.reason = submit.proposal.declineReason || "submit rejected";
      lastResult = `submit rejected: ${safeSnippet(submit.proposal.declineReason || "", 80)}`;
      await emit("abandon", `submit: ${pipelineRecord.reason}`, sessionId);
      return;
    }

    // Submitted — auto-apply will pick up. Clear pipelineState so the closer
    // can mark done when the commit lands.
    await updateTask(task.id, {
      note: `pipeline submitted ${submit.proposal.id} (${edit.playbookId})`,
      pipelineState: { phase: "submitted", proposalId: submit.proposal.id, updatedAt: new Date().toISOString() }
    });
    await recordOutcome(edit.playbookId, { outcome: "shipped", diffLines: 0 });
    pipelineRecord.outcome = "submitted";
    totalShipped += 1;
    outcome = "ship";
    lastResult = `submitted ${submit.proposal.id}`;
  } catch (error) {
    lastResult = `tick error: ${error?.message || "unknown"}`;
    pipelineRecord.outcome = "error";
    pipelineRecord.reason = error?.message || "unknown";
    await appendHermesEvent({
      type: "error",
      role: "system",
      content: `[pipeline] ${lastResult}`
    }).catch(() => {});
  } finally {
    inFlight = false;
    if (pipelineRecord.phase) await appendJournal(pipelineRecord).catch(() => {});
    if (outcome !== "idle") recordCadenceOutcome(outcome);
    // Re-arm next tick at the (possibly adjusted) interval.
    if (timer) {
      clearInterval(timer);
      timer = setInterval(() => void runPipelineTick(), currentInterval);
      timer.unref?.();
    }
  }
}

export function startPipelineWorker() {
  if (timer) return timer;
  if (process.env.PRETEXT_PIPELINE === "false") return null;
  setTimeout(() => void runPipelineTick(), 20_000);
  timer = setInterval(() => void runPipelineTick(), currentInterval);
  timer.unref?.();
  return timer;
}

export function getPipelineStatus() {
  return {
    state: timer ? "running" : "stopped",
    intervalMs: currentInterval,
    baseIntervalMs: TICK_MS,
    models: { search: SEARCH_MODEL, concretize: CONCRETIZE_MODEL, playbook: PLAYBOOK_MODEL },
    totalTicks,
    totalShipped,
    lastTickAt,
    lastResult,
    recentOutcomes: recentOutcomes.slice()
  };
}
