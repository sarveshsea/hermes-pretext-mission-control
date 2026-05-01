// Continuous AI worker that bypasses Hermes's broken cron.
//
// Why this exists: the Hermes cron (pretext-auto-improve at 12m, pretext-pulse
// at 3m) produces nothing actionable. gemma4 errors out with "invalid tool call"
// patterns, gpt-oss runs ok=true but emits no real content. The user wants
// "constant movement" — AI calls firing live, narrating its own work, advancing
// the ledger. So we run that engine here, server-side, calling Ollama directly.
//
// On every tick: build a tight prompt with dashboard state + open ledger tasks,
// call Ollama, parse the response into THINKING + ACTION blocks, fire events
// for each, execute the action through existing validators. Loop.

import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { appendHermesEvent, getHermesEvents } from "./hermesEvents.mjs";
import { getHermesRuntime } from "./hermesRuntime.mjs";
import { getCadence } from "./scheduler.mjs";
import { listTasks, addTask, updateTask } from "./taskLedger.mjs";
import { getMissionState } from "./missions.mjs";
import { createProposal } from "./proposals.mjs";
import { postThemedItem } from "./themedSurfaces.mjs";
import { writeNote } from "./obsidian.mjs";
import { safeSnippet } from "./redaction.mjs";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const SESSION_ID = `worker_${Date.now().toString(36)}`;
const LOOP_INTERVAL_MS = Number(process.env.PRETEXT_WORKER_INTERVAL_MS || 75_000);
const MIN_INTERVAL_MS = 30_000;

let timer = null;
let running = false;
let lastTickAt = null;
let lastResultAt = null;
let lastResultSummary = "boot";
let lastError = null;
let cycles = 0;

function workerStatus() {
  return {
    state: timer ? "running" : "stopped",
    intervalMs: LOOP_INTERVAL_MS,
    cycles,
    sessionId: SESSION_ID,
    lastTickAt,
    lastResultAt,
    lastResultSummary,
    lastError,
    inFlight: running
  };
}

async function buildPrompt() {
  const [tasks, mission, runtime, cadence, recentEvents] = await Promise.all([
    listTasks({ status: "open" }),
    getMissionState(),
    getHermesRuntime(),
    getCadence(),
    getHermesEvents(20)
  ]);
  const taskLines = tasks.length
    ? tasks
        .slice(0, 8)
        .map((t, idx) => `${idx + 1}. [${t.mission}] ${t.title} (id=${t.id}, updated=${t.updatedAt.slice(11, 19)})`)
        .join("\n")
    : "(empty — propose ONE Tier 2 task to advance the dashboard)";
  const recent = recentEvents
    .slice(0, 8)
    .map((e) => `${e.createdAt.slice(11, 19)} ${e.type} ${(e.content || "").slice(0, 60)}`)
    .join("\n");
  const headline = mission?.headline || "idle";
  const userTurn = `# Pretext Mission Control — autonomous worker tick

Cadence: ${cadence.mode} · idle ${cadence.idleSec}s · throttle ${cadence.throttle}
Headline: ${headline}
Active model: ${runtime?.model || "?"}

## Open ledger tasks (advance ONE)
${taskLines}

## Last events
${recent}

## Your job
Pick the least-recently-advanced open task, OR if the ledger is empty, propose
one Tier 2 task. Respond with EXACTLY this format and NOTHING else:

THINKING: <one sentence describing what you will do this tick and why>
ACTION: <one of: NOTE | TASK_ADD | TASK_NOTE | DRAFT | AUDIT | OBSERVE>
PAYLOAD: <single line of JSON for the action — see schemas below>

Schemas:
- NOTE      → {"text": "<observation about dashboard state>"}
- TASK_ADD  → {"title": "<task>", "mission": "<buzzr|memoire|pretext|autofix|naming|obsidian|subscription|general>"}
- TASK_NOTE → {"id": "<task_id from list above>", "note": "<one-line progress>"}
- DRAFT     → {"text": "<buzzr tweet draft, ≤ 240 chars>", "audience": "<x.com followers>"}
- AUDIT     → {"slug": "<short-slug>", "source": "<URL or design system name>", "summary": "<one-line>"}
- OBSERVE   → {"area": "<dashboard|cron|cadence|publish>", "finding": "<one-line>"}

Rules:
- THINKING line is mandatory. Skip the line and your action is rejected.
- ACTION must be one of the listed enums. No code, no shell, no file paths.
- PAYLOAD must be valid single-line JSON.
- If you have nothing useful: choose OBSERVE with a real finding from the
  recent events list. Do not pad.`;
  return userTurn;
}

async function callOllama({ model, prompt }) {
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
        options: {
          temperature: 0.35,
          num_predict: 320,
          num_ctx: 8192,
          top_p: 0.9
        },
        messages: [
          {
            role: "system",
            content:
              "You are the Pretext Mission Control autonomous worker. Output EXACTLY three lines:\n" +
              "THINKING: <one sentence, ≤ 24 words>\n" +
              "ACTION: <NOTE|TASK_ADD|TASK_NOTE|DRAFT|AUDIT|OBSERVE>\n" +
              "PAYLOAD: <single-line JSON>\n" +
              "No shell, no code blocks, no extra commentary."
          },
          { role: "user", content: prompt },
          {
            role: "assistant",
            content:
              "THINKING: Build is healthy at 91KB gzip; noting headroom before code-split.\n" +
              "ACTION: OBSERVE\n" +
              'PAYLOAD: {"area":"dashboard","finding":"build gzip 91 KB - headroom until 200 KB code-split threshold"}'
          },
          { role: "user", content: "Now produce ONE real tick on the open ledger above. Three lines only." }
        ]
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`ollama ${res.status}`);
    const data = await res.json();
    // Reasoning models (gpt-oss:*) put output in message.thinking until the
    // reasoning phase completes; only then does content populate. Take
    // whichever has structured THINKING/ACTION/PAYLOAD lines.
    const content = data.message?.content || "";
    const thinking = data.message?.thinking || "";
    const text = /THINKING:/i.test(content) ? content : /THINKING:/i.test(thinking) ? thinking : content || thinking;
    return {
      text,
      doneReason: data.done_reason || null,
      tokensPerSec:
        data.eval_count && data.eval_duration
          ? Math.round((data.eval_count / (data.eval_duration / 1e9)) * 100) / 100
          : null,
      evalCount: data.eval_count || 0
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseResponse(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const thinking = lines.find((l) => l.toUpperCase().startsWith("THINKING:"))?.replace(/^THINKING:\s*/i, "") || "";
  const actionLine = lines.find((l) => l.toUpperCase().startsWith("ACTION:"))?.replace(/^ACTION:\s*/i, "") || "";
  const action = actionLine.split(/\s+/)[0]?.toUpperCase() || "";
  const payloadLine = lines.find((l) => l.toUpperCase().startsWith("PAYLOAD:"))?.replace(/^PAYLOAD:\s*/i, "") || "{}";
  let payload = {};
  try {
    payload = JSON.parse(payloadLine);
  } catch {
    // try to recover by taking the first JSON-like substring
    const m = payloadLine.match(/\{[\s\S]*\}/);
    if (m) {
      try { payload = JSON.parse(m[0]); } catch { payload = {}; }
    }
  }
  return { thinking, action, payload };
}

async function executeAction({ action, payload }) {
  switch (action) {
    case "NOTE": {
      if (!payload.text) return { ok: false, why: "NOTE missing text" };
      await appendHermesEvent({
        type: "note",
        role: "assistant",
        content: safeSnippet(payload.text, 600),
        sessionId: SESSION_ID
      });
      return { ok: true, summary: `note: ${safeSnippet(payload.text, 80)}` };
    }
    case "TASK_ADD": {
      if (!payload.title) return { ok: false, why: "TASK_ADD missing title" };
      const t = await addTask({ title: payload.title, mission: payload.mission || "general", createdBy: "worker" });
      return { ok: true, summary: `+ task ${t.id} [${t.mission}]: ${safeSnippet(payload.title, 60)}` };
    }
    case "TASK_NOTE": {
      if (!payload.id) return { ok: false, why: "TASK_NOTE missing id" };
      try {
        await updateTask(payload.id, { notes: [payload.note || "(progress)"] });
        return { ok: true, summary: `task_note ${payload.id}: ${safeSnippet(payload.note, 80)}` };
      } catch (e) {
        return { ok: false, why: e?.message || "task update failed" };
      }
    }
    case "DRAFT": {
      if (!payload.text) return { ok: false, why: "DRAFT missing text" };
      const item = await postThemedItem("buzzr_drafts", {
        text: payload.text,
        audience: payload.audience || "x.com followers",
        worstCase: "(worker draft, unverified)"
      });
      return { ok: true, summary: `+ buzzr draft ${item.id}` };
    }
    case "AUDIT": {
      if (!payload.slug || !payload.source) return { ok: false, why: "AUDIT missing slug or source" };
      const date = new Date().toISOString().slice(0, 10);
      const body = `---\nname: ${payload.slug}\nstatus: audit\napplies_to: memoire\nsource: ${payload.source}\naudited_at: ${date}\n---\n\n# ${payload.slug}\n\n## Summary\n${payload.summary || "(pending)"}\n\n## Source\n${payload.source}\n\n## Audit notes\n_(Worker autonomous audit. Sarvesh to verify and expand.)_\n`;
      try {
        await writeNote({ path: `Agent/Memoire Audits/${date}-${payload.slug}.md`, body });
        return { ok: true, summary: `+ audit Agent/Memoire Audits/${date}-${payload.slug}.md` };
      } catch (e) {
        return { ok: false, why: e?.message || "audit write failed" };
      }
    }
    case "OBSERVE": {
      const area = payload.area || "dashboard";
      const finding = payload.finding || "(no finding)";
      await appendHermesEvent({
        type: "mission_update",
        role: "assistant",
        content: `observation [${area}]: ${safeSnippet(finding, 400)}`,
        sessionId: SESSION_ID
      });
      return { ok: true, summary: `observe[${area}]: ${safeSnippet(finding, 80)}` };
    }
    default:
      return { ok: false, why: `unknown action: ${action || "(none)"}` };
  }
}

async function tick() {
  if (running) return; // skip if previous tick still in flight
  running = true;
  lastTickAt = new Date().toISOString();
  cycles += 1;
  try {
    // Default to gemma4:e4b — it emits direct `content`. gpt-oss:20b is a
    // reasoning model that puts everything in `message.thinking` first and
    // often never reaches `content` within a tight token budget. Opt-in via
    // PRETEXT_WORKER_MODEL=gpt-oss:20b if the budget is generous.
    const model = process.env.PRETEXT_WORKER_MODEL || "gemma4:e4b";
    const prompt = await buildPrompt();
    await appendHermesEvent({
      type: "model_call",
      role: "assistant",
      content: `worker tick #${cycles} model=${model}`,
      model,
      iteration: cycles,
      sessionId: SESSION_ID
    });
    const result = await callOllama({ model, prompt });
    const parsed = parseResponse(result.text);
    if (!parsed.thinking) {
      await appendHermesEvent({
        type: "error",
        role: "system",
        content: `worker: no THINKING line; eval_count=${result.evalCount}; raw="${safeSnippet(result.text, 400) || "(empty)"}"`,
        sessionId: SESSION_ID
      });
      lastError = `no THINKING (eval=${result.evalCount}, raw=${(result.text || "").length}c)`;
      lastResultSummary = "no thinking";
      return;
    }
    await appendHermesEvent({
      type: "thinking",
      role: "assistant",
      content: parsed.thinking,
      model,
      iteration: cycles,
      sessionId: SESSION_ID
    });
    const exec = await executeAction({ action: parsed.action, payload: parsed.payload });
    if (!exec.ok) {
      await appendHermesEvent({
        type: "error",
        role: "system",
        content: `worker action ${parsed.action || "?"} failed: ${exec.why}`,
        sessionId: SESSION_ID
      });
      lastError = exec.why;
      lastResultSummary = `${parsed.action || "?"} failed: ${exec.why}`;
    } else {
      lastError = null;
      lastResultSummary = exec.summary;
    }
    lastResultAt = new Date().toISOString();
  } catch (error) {
    lastError = error?.message || "worker tick failed";
    await appendHermesEvent({
      type: "error",
      role: "system",
      content: `worker tick error: ${lastError}`,
      sessionId: SESSION_ID
    }).catch(() => {});
  } finally {
    running = false;
  }
}

export function startContinuousWorker() {
  if (timer) return timer;
  if (process.env.PRETEXT_WORKER === "false") {
    return null;
  }
  // Kick off first tick after 8s so the rest of startup finishes.
  setTimeout(() => void tick(), 8_000);
  timer = setInterval(() => void tick(), Math.max(MIN_INTERVAL_MS, LOOP_INTERVAL_MS));
  timer.unref?.();
  return timer;
}

export function getContinuousWorkerStatus() {
  return workerStatus();
}
