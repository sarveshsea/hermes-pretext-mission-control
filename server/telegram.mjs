import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { appendHermesEvent } from "./hermesEvents.mjs";
import { sanitizeText } from "./redaction.mjs";

const RATE_LIMIT_MS = 30_000;
const ENV_FILE = path.join(ROOTS.hermes, ".env");
const CHANNEL_FILE = path.join(ROOTS.hermes, "channel_directory.json");

let lastSendAt = 0;
let outboundEnabled = process.env.PRETEXT_TELEGRAM_OUTBOUND === "true";
let cachedToken = null;
let cachedChatId = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60_000;

async function readEnvToken() {
  try {
    const text = await fs.readFile(ENV_FILE, "utf8");
    const match = text.match(/^TELEGRAM_BOT_TOKEN\s*=\s*(?:"([^"]+)"|'([^']+)'|(\S+))$/m);
    if (match) return match[1] || match[2] || match[3] || null;
  } catch {
    // env not readable
  }
  return null;
}

async function readHomeChatId() {
  try {
    const text = await fs.readFile(CHANNEL_FILE, "utf8");
    const parsed = JSON.parse(text);
    // Newer schema: {platforms: {telegram: [{id, name, type}]}}
    if (parsed.platforms?.telegram?.length) {
      const tg = parsed.platforms.telegram.find((entry) => entry?.is_home || entry?.role === "home") || parsed.platforms.telegram[0];
      if (tg?.id) return String(tg.id);
      if (tg?.chat_id) return String(tg.chat_id);
    }
    // Older schema: {targets: [...]}
    const targets = Array.isArray(parsed.targets) ? parsed.targets : Object.values(parsed.targets || {});
    const home = targets.find((entry) => entry?.is_home || entry?.role === "home") || targets[0];
    if (home?.chat_id) return String(home.chat_id);
    if (home?.id) return String(home.id);
  } catch {
    // unconfigured
  }
  return null;
}

async function loadCredentials() {
  const now = Date.now();
  if (cachedToken && cachedChatId && now - cacheLoadedAt < CACHE_TTL_MS) {
    return { token: cachedToken, chatId: cachedChatId };
  }
  const [token, chatId] = await Promise.all([readEnvToken(), readHomeChatId()]);
  cachedToken = token;
  cachedChatId = chatId;
  cacheLoadedAt = now;
  return { token, chatId };
}

export function setOutboundEnabled(value) {
  outboundEnabled = Boolean(value);
  return outboundEnabled;
}

export function getOutboundStatus() {
  return {
    enabled: outboundEnabled,
    rateLimitMs: RATE_LIMIT_MS,
    lastSendAt: lastSendAt ? new Date(lastSendAt).toISOString() : null
  };
}

export async function sendTelegramMessage({ text, urgent = false }) {
  if (!outboundEnabled) {
    const error = new Error("Telegram outbound is disabled. Toggle via /api/runtime/telegram-send.");
    error.status = 403;
    throw error;
  }
  if (!text || typeof text !== "string") {
    const error = new Error("text required");
    error.status = 400;
    throw error;
  }
  const now = Date.now();
  if (!urgent && now - lastSendAt < RATE_LIMIT_MS) {
    const error = new Error(
      `Rate-limited. Wait ${Math.ceil((RATE_LIMIT_MS - (now - lastSendAt)) / 1000)}s or use urgent=true.`
    );
    error.status = 429;
    throw error;
  }
  const { token, chatId } = await loadCredentials();
  if (!token || !chatId) {
    const error = new Error("Telegram credentials missing (bot token or home chat).");
    error.status = 500;
    throw error;
  }

  const cleanText = sanitizeText(text).slice(0, 3500);
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = JSON.stringify({ chat_id: chatId, text: cleanText, disable_web_page_preview: true });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  let result;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal
    });
    clearTimeout(timer);
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      const error = new Error(`Telegram API error: ${json.description || res.status}`);
      error.status = res.status;
      throw error;
    }
    lastSendAt = now;
    result = { ok: true, messageId: json.result?.message_id, sentAt: new Date(now).toISOString() };
  } finally {
    clearTimeout(timer);
  }

  await appendHermesEvent({
    type: "telegram_out",
    role: "assistant",
    content: cleanText,
    sessionId: chatId,
    extra: { source: "dashboard-outbound", urgent }
  });
  return result;
}
