import { getHermesEvents } from "./hermesEvents.mjs";
import { getHermesRuntime } from "./hermesRuntime.mjs";

const MISSION_WINDOW = 80;

function pickMissionLine(events) {
  const recent = events.filter(
    (event) => event.type === "telegram_in" || event.type === "iteration_tick" || event.type === "mission_start" || event.type === "mission_update"
  );
  return recent[0]?.content || "";
}

function summarizeThinking(events) {
  // Prefer real reasoning events; fall back to recent run_request / mission_update
  // so the THINKING pane is never empty just because the model didn't call
  // bridge.thinking() this tick.
  const primary = events.filter(
    (event) =>
      event.type === "telegram_out" ||
      event.type === "thinking" ||
      event.type === "model_call" ||
      event.type === "model_result"
  );
  const fallback = events.filter(
    (event) =>
      event.type === "mission_update" ||
      event.type === "iteration_tick" ||
      event.type === "run_request"
  );
  const out = primary.length >= 3 ? primary : [...primary, ...fallback];
  return out.slice(0, 8).map((event) => ({
    id: event.id,
    at: event.createdAt,
    type: event.type,
    content: event.content
  }));
}

function summarizeTools(events) {
  return events
    .filter((event) => event.type === "tool_call" || event.type === "tool_result" || event.type === "run_request" || event.type === "run_result")
    .slice(0, 8);
}

function summarizeMemory(events) {
  return events
    .filter((event) => event.type === "memory_read" || event.type === "memory_write" || event.type === "note")
    .slice(0, 6);
}

function eventRate(events, windowMs = 60_000) {
  const cutoff = Date.now() - windowMs;
  return events.filter((event) => new Date(event.createdAt).getTime() >= cutoff).length;
}

export async function getMissionState() {
  const [events, runtime] = await Promise.all([getHermesEvents(MISSION_WINDOW), getHermesRuntime()]);
  const lastInbound = events.find((event) => event.type === "telegram_in");
  const lastOutbound = events.find((event) => event.type === "telegram_out");
  const thinking = summarizeThinking(events);
  const tools = summarizeTools(events);
  const memory = summarizeMemory(events);
  const rate1m = eventRate(events, 60_000);
  const rate5m = eventRate(events, 5 * 60_000);
  const lastEventAt = events[0]?.createdAt || null;
  return {
    runtime,
    headline: pickMissionLine(events) || "idle — waiting for instruction",
    lastInbound: lastInbound
      ? { at: lastInbound.createdAt, content: lastInbound.content, sessionId: lastInbound.sessionId }
      : null,
    lastOutbound: lastOutbound
      ? { at: lastOutbound.createdAt, content: lastOutbound.content, sessionId: lastOutbound.sessionId }
      : null,
    thinking,
    tools,
    memory,
    rate1m,
    rate5m,
    lastEventAt
  };
}
