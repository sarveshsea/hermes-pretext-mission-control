import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";

const TTL_MS = 6000;
let cache = { value: null, at: 0 };

function maskChatId(value) {
  const text = String(value ?? "");
  if (text.length <= 4) return text;
  return `${text.slice(0, 2)}***${text.slice(-3)}`;
}

export async function getHermesSessions({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.value && now - cache.at < TTL_MS) return cache.value;
  let parsed = {};
  try {
    const text = await fs.readFile(path.join(ROOTS.hermesSessions, "sessions.json"), "utf8");
    parsed = JSON.parse(text);
  } catch {
    parsed = {};
  }
  const entries = Object.entries(parsed)
    .map(([key, raw]) => {
      const session = raw || {};
      const lastUpdated = session.updated_at || session.last_seen || session.created_at || null;
      const platform = (session.platform || key.split(":")[2] || "unknown").slice(0, 24);
      const chatId = session.chat_id || key.split(":").pop() || null;
      return {
        key,
        platform,
        chatId: chatId ? maskChatId(chatId) : null,
        sessionId: session.session_id || null,
        userName: session.user_name || session.display_name || null,
        createdAt: session.created_at || null,
        updatedAt: lastUpdated,
        messageCount: session.message_count || session.turn_count || 0,
        modelOverride: session.model_override || null
      };
    })
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .slice(0, 24);
  const value = { generatedAt: new Date().toISOString(), sessions: entries };
  cache = { value, at: now };
  return value;
}
