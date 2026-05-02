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

import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { appendHermesEvent } from "./hermesEvents.mjs";
import { listTasks, updateTask } from "./taskLedger.mjs";
import { searchCode } from "./codeSearch.mjs";
import { listPlaybooks } from "./playbookLoader.mjs";
import { rankedPlaybooks, recordOutcome } from "./playbookStats.mjs";
import { createProposal } from "./proposals.mjs";
import { getSharedContext, formatSharedContextBlock } from "./swarmContext.mjs";
import { getCodeIndex, renderIndexBlock } from "./codeIndex.mjs";
import { appendJournal, formatJournalForPrompt, readJournalTail } from "./pipelineJournal.mjs";
import { runOllama } from "./ollamaQueue.mjs";
import { getPlan, recordStepResult, reflect } from "./harness.mjs";
import { safeSnippet } from "./redaction.mjs";
// Phase-specific models. Default to gemma4:e4b across all phases so we don't
// fight the swarm for VRAM (model-swapping kills throughput). Set
// PRETEXT_PIPELINE_*_MODEL=gpt-oss:20b once you're ready to spend the cycles
// for sharper concretize/playbook output.
const SEARCH_MODEL = process.env.PRETEXT_PIPELINE_SEARCH_MODEL || "gemma4:e4b";
const CONCRETIZE_MODEL = process.env.PRETEXT_PIPELINE_CONCRETIZE_MODEL || "gemma4:e4b";
const PLAYBOOK_MODEL = process.env.PRETEXT_PIPELINE_PLAYBOOK_MODEL || "gemma4:e4b";
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
  // The queue serializes per-model so multiple swarm calls can pile up. Pipeline
  // is the highest-leverage caller — give it generous headroom past queue wait.
  // gpt-oss:20b can take 60-120s on cold load + 20-40s warm.
  const timeoutMs = /20b|13b|llama3.1:8b/.test(model) ? 240_000 : 180_000;
  const start = Date.now();
  const data = await runOllama({
    model,
    endpoint: "/api/chat",
    timeoutMs,
    body: {
      keep_alive: "24h",
      stream: false,
      format: "json",
      think: false,
      options: { temperature: 0.3, num_predict: 1000, num_ctx: 8192, top_p: 0.9 },
      messages: [
        { role: "system", content: `${system}\n\nReply with ONE valid JSON object only. No markdown, no preamble.` },
        { role: "user", content: user }
      ]
    }
  });
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

// Track outcome for adaptive cadence.
//   - Any ship → reset to baseline immediately (heals back-off after recovery).
//   - 3 consecutive ships → halve below baseline (faster on a hot streak).
//   - 3 consecutive abandons → double (back off when stuck).
function recordCadenceOutcome(kind) {
  recentOutcomes.push(kind);
  if (recentOutcomes.length > 6) recentOutcomes.shift();
  if (kind === "ship") {
    // Heal the back-off on first ship after a stall.
    if (currentInterval > TICK_MS) currentInterval = TICK_MS;
  }
  const last3 = recentOutcomes.slice(-3);
  if (last3.length === 3 && last3.every((o) => o === "ship")) {
    currentInterval = Math.max(MIN_INTERVAL_MS, Math.floor(currentInterval / 2));
  } else if (last3.length === 3 && last3.every((o) => o === "abandon")) {
    currentInterval = Math.min(MAX_INTERVAL_MS, currentInterval * 2);
  }
}

// Manual override: operator-triggered reset (button in WHY strip).
export function resetPipelineCadence() {
  currentInterval = TICK_MS;
  recentOutcomes.length = 0;
  return { intervalMs: currentInterval };
}

async function pickTask() {
  const open = await listTasks({ status: "open" });
  if (!open.length) return null;
  const now = Date.now();

  // 1) Active multi-step plans first — advance them step by step.
  const planTasks = open
    .filter((t) => t.pipelineState?.phase === "plan" && t.pipelineState?.plan_id)
    .sort((a, b) => new Date(a.pipelineState.updatedAt || a.updatedAt) - new Date(b.pipelineState.updatedAt || b.updatedAt));
  for (const task of planTasks) {
    const rec = taskAttempts.get(task.id);
    if (rec && now - rec.lastAt < ATTEMPT_COOLDOWN_MS) continue;
    return task;
  }

  // 2) Tasks already mid-pipeline (concretized/searched/playbooked) — resume.
  const inProgress = open
    .filter((t) => t.pipelineState && t.pipelineState.phase && !["abandoned", "plan", "submitted"].includes(t.pipelineState.phase))
    .sort((a, b) => new Date(a.pipelineState.updatedAt || a.updatedAt) - new Date(b.pipelineState.updatedAt || b.updatedAt));
  for (const task of inProgress) {
    const rec = taskAttempts.get(task.id);
    if (rec && now - rec.lastAt < ATTEMPT_COOLDOWN_MS) continue;
    return task;
  }

  // 3) Otherwise: oldest concrete task (skip ones tagged needs_design).
  //    But always prefer manual-priority tasks first — they came from the dashboard operator.
  const sorted = open
    .filter((t) => !(t.tags || []).includes("needs_design"))
    .sort((a, b) => {
      const aPri = (a.tags || []).includes("manual-priority") ? 1 : 0;
      const bPri = (b.tags || []).includes("manual-priority") ? 1 : 0;
      if (aPri !== bPri) return bPri - aPri;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
  for (const task of sorted) {
    const rec = taskAttempts.get(task.id);
    if (rec && now - rec.lastAt < ATTEMPT_COOLDOWN_MS) continue;
    return task;
  }
  return null;
}

// planAdvancePhase: when a task carries plan_id, advance ONE step per tick.
// Records the step result; on final step, reflects + closes the parent task.
// Returns {ok: true, advanced: true} when handled (caller should skip
// concretize/search/playbook for this tick — plan steps are LLM-prompted by
// being injected as the effective task title in the next tick's pipeline).
async function planAdvancePhase({ task, sessionId }) {
  const planId = task.pipelineState?.plan_id;
  if (!planId) return { ok: false, reason: "no plan_id" };
  const plan = await getPlan(planId);
  if (!plan) return { ok: false, reason: `plan ${planId} not found` };
  const idx = plan.currentStep || 0;
  const step = plan.steps[idx];
  if (!step) return { ok: false, reason: "plan has no current step" };
  await emit("planAdvance", `${plan.id} step ${idx + 1}/${plan.steps.length}: ${safeSnippet(step.text, 80)}`, sessionId, {
    planId: plan.id,
    stepIdx: idx,
    stepText: step.text
  });
  // Mark step as 'advanced' for now — the next tick will pick the same task
  // and concretize against the step text. On the LAST step, we also reflect
  // + close the parent task.
  if (idx >= plan.steps.length - 1) {
    await recordStepResult(plan.id, idx, { result: "final step reached", decision: "next" });
    await reflect(plan.id, "completed via pipeline planAdvance");
    await updateTask(task.id, {
      status: "done",
      note: `plan ${plan.id} complete — reflected`,
      pipelineState: { phase: "plan-done", plan_id: plan.id, updatedAt: new Date().toISOString() }
    });
    return { ok: true, advanced: true, completed: true };
  }
  await recordStepResult(plan.id, idx, { result: `pipeline advance — see step ${idx + 2}`, decision: "next" });
  await updateTask(task.id, {
    pipelineState: {
      phase: "plan",
      plan_id: plan.id,
      currentStep: idx + 1,
      updatedAt: new Date().toISOString()
    },
    note: `plan step ${idx + 1}/${plan.steps.length} advanced`
  });
  return { ok: true, advanced: true, completed: false };
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

// readFileContext: when concretize already produced a real file_path, we
// don't need an LLM-driven search. Just read the file directly and produce
// "matches" the playbook phase can ground on. Saves an Ollama call AND
// always succeeds when the file exists.
async function readFileContext({ concretize, sessionId }) {
  if (!concretize?.file_path) return { ok: false, reason: "no file_path from concretize" };
  const { promises: fs } = await import("node:fs");
  const path = await import("node:path");
  const { ROOTS } = await import("./config.mjs");
  const target = path.default.join(ROOTS.project, concretize.file_path);
  let text;
  try {
    text = await fs.readFile(target, "utf8");
  } catch (error) {
    return { ok: false, reason: `cannot read ${concretize.file_path}: ${error?.message || "unknown"}` };
  }
  if (!text) return { ok: false, reason: `${concretize.file_path} is empty` };
  // Synthesize "matches" by chunking the file into representative lines:
  // first 30 lines + any line ≥ 30 chars. Caps at ~40 lines so the prompt
  // stays small.
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length && out.length < 40; i += 1) {
    const line = lines[i];
    if (i < 30 || line.length >= 30) {
      out.push({ file: concretize.file_path, line: i + 1, snippet: line.slice(0, 240) });
    }
  }
  await emit("search", `read ${concretize.file_path} — ${lines.length} lines (${out.length} surfaced)`, sessionId);
  return { ok: true, pattern: "(file-direct)", glob: concretize.file_path, matches: out, fullText: text };
}

// Programmatic find-string repair. The LLM (gemma especially) often hallucinates
// the find substring — paraphrases whitespace, gets indentation wrong, omits a
// trailing char. This function reads the actual target file and tries to recover
// a real verbatim substring that produces the same semantic edit. Returns:
//   { ok: true, find: <actual file substring>, repaired: bool }
//   { ok: false, reason }
async function repairFindString(filePath, find) {
  let body;
  try {
    body = await fs.readFile(path.join(ROOTS.project, filePath), "utf8");
  } catch (error) {
    return { ok: false, reason: `cannot read ${filePath}: ${error.message}` };
  }
  // Verbatim?
  if (body.includes(find)) {
    // Also reject if the substring is non-unique — we need a unique target.
    const occurrences = body.split(find).length - 1;
    if (occurrences > 1) return { ok: false, reason: `find string appears ${occurrences}× — not unique` };
    return { ok: true, find, repaired: false };
  }
  // Whitespace-normalized search: collapse all whitespace runs into single space
  // in both haystack and needle, find offset, then map back to the original.
  const normWS = (s) => s.replace(/\s+/g, " ");
  const bodyNorm = normWS(body);
  const findNorm = normWS(find);
  if (findNorm.length < 12) return { ok: false, reason: "find too short to safely repair" };
  const idx = bodyNorm.indexOf(findNorm);
  if (idx === -1) return { ok: false, reason: "find string not found in file even after whitespace-normalize" };
  const lastIdx = bodyNorm.lastIndexOf(findNorm);
  if (idx !== lastIdx) return { ok: false, reason: "find string non-unique under whitespace-normalize" };
  // Map normalized offset back to raw offset by counting raw chars consumed.
  let rawStart = 0;
  let normCount = 0;
  while (normCount < idx && rawStart < body.length) {
    if (/\s/.test(body[rawStart])) {
      while (rawStart < body.length && /\s/.test(body[rawStart])) rawStart += 1;
      normCount += 1;
    } else {
      rawStart += 1;
      normCount += 1;
    }
  }
  // Now consume raw chars equivalent to findNorm.length
  let rawEnd = rawStart;
  let consumed = 0;
  while (consumed < findNorm.length && rawEnd < body.length) {
    if (/\s/.test(body[rawEnd])) {
      while (rawEnd < body.length && /\s/.test(body[rawEnd])) rawEnd += 1;
      consumed += 1;
    } else {
      rawEnd += 1;
      consumed += 1;
    }
  }
  const actualFind = body.slice(rawStart, rawEnd);
  if (!body.includes(actualFind) || body.split(actualFind).length - 1 !== 1) {
    return { ok: false, reason: "repair produced non-unique or missing slice" };
  }
  return { ok: true, find: actualFind, repaired: true };
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
  // Repair the find string against the actual file contents — the LLM often
  // hallucinates whitespace or paraphrases. If repair fails, reject loudly.
  const repair = await repairFindString(parsed.filePath, parsed.find);
  if (!repair.ok) {
    await appendHermesEvent({
      type: "thinking",
      role: "assistant",
      content: `[pipeline:playbook] find-string repair failed: ${repair.reason}`,
      sessionId
    });
    return { ok: false, reason: `find-string repair: ${repair.reason}` };
  }
  if (repair.repaired) {
    await appendHermesEvent({
      type: "thinking",
      role: "assistant",
      content: `[pipeline:playbook] repaired find-string against ${parsed.filePath} (whitespace mismatch)`,
      sessionId
    });
  }
  const finalFind = repair.find;
  await emit("playbook", `${parsed.playbook_id} → ${parsed.filePath}${repair.repaired ? " (find repaired)" : ""}`, sessionId, { playbook: parsed.playbook_id, latencyMs, model: PLAYBOOK_MODEL, repaired: repair.repaired });
  return {
    ok: true,
    playbookId: parsed.playbook_id,
    filePath: parsed.filePath,
    find: finalFind,
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
      // Cadence heal: if there's nothing to pick, reset interval to baseline
      // so we're ready when work shows up. Prevents 10-min cap from sticking.
      if (currentInterval > TICK_MS) currentInterval = TICK_MS;
      return;
    }
    const sessionId = `pipeline_${task.id}`;
    const memAttempts = (taskAttempts.get(task.id)?.attempts || 0) + 1;
    const persistedAttempts = (task.pipelineState?.attempts || 0);
    const totalAttemptsForTask = Math.max(memAttempts, persistedAttempts + 1);
    taskAttempts.set(task.id, { lastAt: Date.now(), attempts: memAttempts });
    pipelineRecord.taskId = task.id;
    pipelineRecord.taskTitle = task.title;

    // Hard-abandon: after 3 cumulative attempts on the same task, mark it
    // abandoned so the pipeline stops looping on broken seeds (find string
    // not unique, find string not found, etc.). The closer can also escalate
    // these to a "needs human edit" follow-up if needed.
    if (totalAttemptsForTask >= 2) {
      await updateTask(task.id, {
        status: "abandoned",
        note: `hard-abandon after ${totalAttemptsForTask} pipeline attempts (last: ${task.pipelineState?.lastError || "unknown"}) — claudeAgent will pick it up`,
        pipelineState: { ...(task.pipelineState || {}), phase: "abandoned", attempts: totalAttemptsForTask, abandonedAt: new Date().toISOString() }
      });
      await emit("abandon", `hard-abandon ${task.id} after ${totalAttemptsForTask} attempts`, sessionId);
      pipelineRecord.phase = "hard-abandon";
      pipelineRecord.outcome = "abandon";
      pipelineRecord.reason = `${totalAttemptsForTask} attempts`;
      lastResult = `hard-abandon ${task.id}`;
      return;
    }

    const [sharedCtx, codeIndex, journalEntries] = await Promise.all([
      getSharedContext(),
      getCodeIndex(),
      readJournalTail(20)
    ]);
    const sharedBlock = formatSharedContextBlock(sharedCtx);
    const indexBlock = renderIndexBlock(codeIndex, { mission: task.mission });
    const journalBlock = formatJournalForPrompt(journalEntries);

    await emit("pickTask", `${task.id} [${task.mission}] ${task.title}`, sessionId);

    // Plan advance: if this task is a multi-step plan, advance one step then
    // exit — concretize/search/playbook run on the NEXT tick once the new
    // step text is the effective task title. Spreads work across ticks.
    if (task.pipelineState?.phase === "plan" && task.pipelineState?.plan_id) {
      const advance = await planAdvancePhase({ task, sessionId });
      pipelineRecord.phase = "planAdvance";
      pipelineRecord.outcome = advance.completed ? "submitted" : "advanced";
      if (advance.completed) {
        outcome = "ship";
        totalShipped += 1;
        lastResult = `plan complete: ${task.pipelineState.plan_id}`;
      } else {
        lastResult = `plan advanced step → next tick`;
      }
      return;
    }

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

    // Search phase: when concretize gave us a real file, skip the LLM search
    // and read the file directly. This is the cheap path that always works.
    const search = await readFileContext({ concretize, sessionId });
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
