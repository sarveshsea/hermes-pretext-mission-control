// Parallel autonomous worker swarm.
//
// Replaces the single continuousWorker that produced the same narration every
// tick because the prompt + model + interval were identical. The swarm runs 6
// specialized workers in parallel, each with its own short directive prompt,
// its own cadence, and its own action verb. Each worker uses Ollama's JSON
// mode (format: "json") so structured output is guaranteed. When parsing or
// the model fails, the worker still posts a deterministic event so the
// dashboard never goes quiet.

import { appendHermesEvent, getHermesEvents } from "./hermesEvents.mjs";
import { listTasks, addTask, updateTask } from "./taskLedger.mjs";
import { postThemedItem } from "./themedSurfaces.mjs";
import { writeNote } from "./obsidian.mjs";
import { safeSnippet } from "./redaction.mjs";
import { spawnSubagent, updateSubagent, listSubagents } from "./subagents.mjs";
import { createProposal } from "./proposals.mjs";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.PRETEXT_SWARM_MODEL || "gemma4:e4b";

const WORKERS = [
  {
    id: "observer",
    label: "observer",
    intervalMs: 18_000,
    mission: "general",
    system:
      "You are the OBSERVER worker. Watch the dashboard's recent events and state. " +
      "Output one observation about what is changing or notable. Return JSON with keys: " +
      '{"thinking": "<one short sentence>", "finding": "<one observation, ≤ 140 chars>", "area": "<dashboard|cron|cadence|publish|ledger>"}.'
  },
  {
    id: "design",
    label: "design",
    intervalMs: 35_000,
    mission: "design",
    system:
      "You are the DESIGN worker. Propose ONE small dashboard visual refinement to add as a task. " +
      "Return JSON: " +
      '{"thinking": "<one short sentence>", "title": "<task title, ≤ 80 chars>", "rationale": "<why, ≤ 120 chars>"}.'
  },
  {
    id: "buzzr",
    label: "buzzr",
    intervalMs: 45_000,
    mission: "buzzr",
    system:
      "You are the BUZZR copywriter. Draft ONE punchy launch tweet for Buzzr — a mobile sports app for micro-fan communities (NFL/NBA/MLS). " +
      "Voice: Sarvesh-as-founder, confident, specific, no hashtag spam, ≤ 220 chars. " +
      'Return JSON: {"thinking": "<short reason for this angle>", "text": "<tweet draft>", "audience": "<x.com followers|sports fans|founders>"}.'
  },
  {
    id: "memoire",
    label: "memoire",
    intervalMs: 55_000,
    mission: "memoire",
    system:
      "You are the MEMOIRE audit worker. Suggest ONE design system or app to audit for Memoire (a memory/journal app). " +
      'Return JSON: {"thinking": "<short reason>", "slug": "<short-slug>", "source": "<system or URL>", "summary": "<one-line audit angle>"}.'
  },
  {
    id: "autofix",
    label: "autofix",
    intervalMs: 35_000,
    mission: "autofix",
    system:
      "You are the AUTOFIX worker. Look at recent run_result and error events; pick a small, concrete fix idea. " +
      'Return JSON: {"thinking": "<one sentence>", "title": "<task title>", "area": "<area being fixed>"}.'
  },
  {
    id: "obsidian",
    label: "obsidian",
    intervalMs: 55_000,
    mission: "obsidian",
    system:
      "You are the OBSIDIAN gardener. Suggest ONE small vault improvement (index note, link cleanup, new section). " +
      'Return JSON: {"thinking": "<short reason>", "title": "<task title>", "path_hint": "<relative vault path>"}.'
  },
  {
    id: "planner",
    label: "planner",
    intervalMs: 50_000,
    mission: "general",
    system:
      "You are the PLANNER. Read the open ledger and recent events; identify ONE multi-step plan that breaks a large task into 3-5 sub-tasks. " +
      'Return JSON: {"thinking": "<one sentence>", "parent_title": "<the larger goal>", "subtasks": ["sub 1", "sub 2", "sub 3"], "mission": "<mission name>"}.'
  },
  {
    id: "critic",
    label: "critic",
    intervalMs: 40_000,
    mission: "general",
    system:
      "You are the CRITIC. Look at recent thinking and proposals; flag ONE thing that is unclear, redundant, or low-value. " +
      'Return JSON: {"thinking": "<one sentence>", "target": "<what is flawed>", "critique": "<≤ 140 chars>", "suggestion": "<≤ 120 chars>"}.'
  },
  {
    id: "sports",
    label: "sports",
    intervalMs: 40_000,
    mission: "sports",
    system:
      "You are the SPORTS RADAR worker. Surface ONE notable storyline from a major league (NFL / NBA / MLS / NCAA / MLB). " +
      "Pull from your training (you don't have live web). Pick something fresh-feeling and angle-able for a sports app. " +
      'Return JSON: {"thinking": "<one sentence>", "league": "<NFL|NBA|MLS|NCAA|MLB>", "headline": "<≤ 140 chars>", "source": "<imagined outlet name>"}.'
  },
  {
    id: "executor",
    label: "executor",
    intervalMs: 55_000,
    mission: "general",
    system:
      "You are the EXECUTOR worker. Your job is to turn an OPEN LEDGER TASK into a concrete shell command that will produce a real diff. " +
      "Look at the open tasks, pick the most actionable one, and write a SAFE shell pipeline (no rm, no sudo, no curl|sh, no chmod) that edits a file under /Users/sarveshchidambaram/Desktop/Projects/Other/pretext. " +
      "Examples: `cd /Users/...pretext && printf '\\n## %s - <title>\\n\\n- <line>\\n' \"$(date +%Y-%m-%d)\" >> CHANGELOG.md && git add CHANGELOG.md && git commit -m '<title>' && git push` " +
      "Or: `cd /Users/...pretext && sed -i '' 's/old/new/' src/styles.css && git add -A && git commit -m '<title>' && git push`. " +
      'Return JSON: {"thinking": "<one sentence>", "task_id": "<id from list>", "title": "<≤ 80 chars matching the diff>", "rationale": "<≤ 120 chars>", "command": "<exact shell pipeline ending with git push>"}.'
  },
  {
    id: "selfimprove",
    label: "selfimprove",
    intervalMs: 120_000,
    mission: "pretext",
    system:
      "You are the SELFIMPROVE worker. Propose ONE small visible refinement to the Pretext dashboard itself — a CSS tweak, a copy edit, a new column in a pane, a typography refinement. The change should help Sarvesh see what Hermes is doing more clearly. " +
      "Output a SAFE shell pipeline (sed -i '' or printf >>). Files under src/ or server/ only. Always end with git add + git commit + git push. " +
      'Return JSON: {"thinking": "<one sentence>", "title": "<≤ 80 chars>", "rationale": "<≤ 120 chars>", "command": "<exact pipeline>"}.'
  }
];

const swarmState = {
  startedAt: null,
  workers: WORKERS.map((w) => ({
    id: w.id,
    label: w.label,
    intervalMs: w.intervalMs,
    cycles: 0,
    inFlight: false,
    lastTickAt: null,
    lastResultAt: null,
    lastResult: "boot",
    lastError: null,
    subagentId: null
  }))
};
const timers = [];

async function ensureSubagent(spec, status) {
  if (status.subagentId) return status.subagentId;
  try {
    // Reuse existing subagent for this worker label if already in the ledger
    // (avoids duplication on dashboard restart).
    const existing = await listSubagents({ limit: 200 });
    const match = existing.find(
      (s) => s.intent && s.intent.startsWith(`${spec.label} swarm worker`)
    );
    if (match) {
      status.subagentId = match.id;
      await updateSubagent(match.id, { status: "running" });
      return status.subagentId;
    }
    const sub = await spawnSubagent({
      intent: `${spec.label} swarm worker — ${spec.system.split(".")[0]}`,
      mission: spec.mission,
      modelHint: DEFAULT_MODEL,
      steps: [`tick every ${Math.round(spec.intervalMs / 1000)}s`]
    });
    status.subagentId = sub.id;
    await updateSubagent(sub.id, { status: "running" });
  } catch {
    // best-effort
  }
  return status.subagentId;
}

function statusFor(id) {
  return swarmState.workers.find((w) => w.id === id);
}

async function callOllamaJson({ model, system, user }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        keep_alive: "24h",
        stream: false,
        format: "json",
        // Disable hidden reasoning channel so output lands in .content not .thinking
        think: false,
        options: { temperature: 0.5, num_predict: 600, num_ctx: 4096, top_p: 0.9 },
        messages: [
          {
            role: "system",
            content: `${system}\n\nReply with ONE valid JSON object only. No markdown, no preamble, no commentary.`
          },
          { role: "user", content: user }
        ]
      }),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`ollama ${res.status}`);
    const data = await res.json();
    const content = data.message?.content || "";
    const thinkingField = data.message?.thinking || "";
    const text = content || thinkingField;
    let parsed = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch { parsed = {}; }
      }
    }
    return { parsed, raw: text, evalCount: data.eval_count || 0 };
  } finally {
    clearTimeout(timer);
  }
}

async function buildUserContext(missionFilter) {
  const [tasks, events] = await Promise.all([
    listTasks({ status: "open" }),
    getHermesEvents(15)
  ]);
  const recent = events.slice(0, 6).map((e) => `${e.createdAt.slice(11, 19)} ${e.type} ${(e.content || "").slice(0, 60)}`).join("\n");
  const taskLines = tasks
    .filter((t) => !missionFilter || t.mission === missionFilter || t.mission === "general")
    .slice(0, 5)
    .map((t) => `- [${t.mission}] ${t.title} (id=${t.id})`)
    .join("\n") || "(no open tasks in your mission)";
  return `Recent events:\n${recent}\n\nOpen tasks:\n${taskLines}\n\nProduce ONE JSON object as instructed.`;
}

async function runWorker(spec) {
  const status = statusFor(spec.id);
  if (status.inFlight) return;
  status.inFlight = true;
  status.lastTickAt = new Date().toISOString();
  status.cycles += 1;
  const sessionId = `swarm_${spec.id}`;
  await ensureSubagent(spec, status);
  try {
    await appendHermesEvent({
      type: "model_call",
      role: "assistant",
      content: `[${spec.label}] tick #${status.cycles}`,
      model: DEFAULT_MODEL,
      iteration: status.cycles,
      sessionId,
      intent: status.subagentId || undefined
    });
    const userContext = await buildUserContext(spec.mission);
    const result = await callOllamaJson({ model: DEFAULT_MODEL, system: spec.system, user: userContext });

    const thinking = result.parsed.thinking || result.parsed.reason || "";
    if (thinking) {
      await appendHermesEvent({
        type: "thinking",
        role: "assistant",
        content: `[${spec.label}] ${thinking}`,
        model: DEFAULT_MODEL,
        iteration: status.cycles,
        sessionId
      });
    }

    let resultSummary = null;
    if (Object.keys(result.parsed).length === 0) {
      // Deterministic fallback so this worker still produces an event.
      await appendHermesEvent({
        type: "note",
        role: "system",
        content: `[${spec.label}] model returned no JSON; raw=${safeSnippet(result.raw, 160) || "(empty)"}`,
        sessionId
      });
      resultSummary = "no json";
    } else {
      // Dispatch the worker-specific action.
      switch (spec.id) {
        case "observer": {
          const finding = result.parsed.finding || result.parsed.observation || "";
          const area = result.parsed.area || "dashboard";
          if (finding) {
            await appendHermesEvent({
              type: "mission_update",
              role: "assistant",
              content: `[observer:${area}] ${finding}`,
              sessionId
            });
            resultSummary = `observe ${area}: ${safeSnippet(finding, 60)}`;
          }
          break;
        }
        case "design":
        case "autofix":
        case "obsidian": {
          const title = result.parsed.title || result.parsed.task || "";
          if (title) {
            const t = await addTask({
              title: safeSnippet(title, 200),
              mission: spec.mission,
              createdBy: `swarm:${spec.id}`,
              notes: result.parsed.rationale ? [safeSnippet(result.parsed.rationale, 240)] : []
            });
            resultSummary = `+ task ${t.id} [${spec.mission}]: ${safeSnippet(title, 60)}`;
          }
          break;
        }
        case "buzzr": {
          const text = result.parsed.text || result.parsed.tweet || "";
          if (text) {
            const item = await postThemedItem("buzzr_drafts", {
              text: safeSnippet(text, 280),
              audience: result.parsed.audience || "x.com followers",
              worstCase: "(swarm draft, unverified)"
            });
            resultSummary = `+ buzzr draft ${item.id}: ${safeSnippet(text, 60)}`;
          }
          break;
        }
        case "memoire": {
          const slug = (result.parsed.slug || "audit").replace(/[^a-z0-9-]/gi, "-").slice(0, 40).toLowerCase();
          const source = result.parsed.source || "";
          if (source) {
            const t = await addTask({
              title: `Memoire audit: ${safeSnippet(source, 120)}`,
              mission: "memoire",
              createdBy: "swarm:memoire",
              notes: [`source: ${source}`, `slug: ${slug}`, result.parsed.summary || ""].filter(Boolean)
            });
            resultSummary = `+ memoire audit task ${t.id}: ${safeSnippet(source, 60)}`;
          }
          break;
        }
        case "sports": {
          const headline = result.parsed.headline || "";
          const league = result.parsed.league || "general";
          if (headline) {
            const item = await postThemedItem("sports_radar", {
              kind: "headline",
              league,
              source: result.parsed.source || "swarm",
              headline: safeSnippet(headline, 280)
            });
            resultSummary = `+ sports_radar [${league}] ${item.id}: ${safeSnippet(headline, 60)}`;
          }
          break;
        }
        case "executor":
        case "selfimprove": {
          const command = result.parsed.command || "";
          const title = result.parsed.title || "";
          const rationale = result.parsed.rationale || "";
          // Server-side safety: never let the executor escape the project dir
          // or run anything destructive. The proposal validator will also gate.
          const looksDestructive = /\b(rm\s+-rf|sudo|chmod\s|curl\s+[^|]*\|\s*(sh|bash)|wget\s+[^|]*\|\s*(sh|bash)|dd\s+if=|mkfs)\b/.test(command);
          if (!command || !title) {
            resultSummary = `${spec.id}: model returned no command/title`;
            break;
          }
          if (looksDestructive) {
            resultSummary = `${spec.id}: refused destructive command pattern`;
            break;
          }
          try {
            const proposal = await createProposal({
              title: safeSnippet(title, 200),
              rationale: safeSnippet(rationale || `swarm:${spec.id}`, 600),
              kind: "shell",
              command: safeSnippet(command, 800),
              autoSafe: true,
              sessionId
            });
            resultSummary = `+ proposal ${proposal.id} ${proposal.status}: ${safeSnippet(title, 50)}`;
          } catch (e) {
            resultSummary = `${spec.id}: proposal create failed — ${e?.message || "unknown"}`;
          }
          break;
        }
      }
    }

    if (!resultSummary) {
      // The model returned something but it was empty for our action shape.
      await appendHermesEvent({
        type: "note",
        role: "assistant",
        content: `[${spec.label}] tick produced no actionable payload`,
        sessionId
      });
      resultSummary = "no actionable payload";
    }
    status.lastResult = resultSummary;
    status.lastResultAt = new Date().toISOString();
    status.lastError = null;
    if (status.subagentId) {
      void updateSubagent(status.subagentId, { result: resultSummary, status: "running" }).catch(() => {});
    }
  } catch (err) {
    status.lastError = err?.message || "tick failed";
    await appendHermesEvent({
      type: "note",
      role: "system",
      content: `[${spec.label}] error: ${status.lastError}`,
      sessionId
    }).catch(() => {});
  } finally {
    status.inFlight = false;
  }
}

export function startWorkerSwarm() {
  if (timers.length) return timers;
  if (process.env.PRETEXT_SWARM === "false") return null;
  swarmState.startedAt = new Date().toISOString();
  // Stagger the initial fires so they don't all hammer Ollama at boot.
  WORKERS.forEach((spec, idx) => {
    setTimeout(() => {
      void runWorker(spec);
      const t = setInterval(() => void runWorker(spec), spec.intervalMs);
      t.unref?.();
      timers.push(t);
    }, 4_000 + idx * 2_500);
  });
  return timers;
}

export function getSwarmStatus() {
  return {
    startedAt: swarmState.startedAt,
    model: DEFAULT_MODEL,
    workers: swarmState.workers.map((w) => ({ ...w }))
  };
}
