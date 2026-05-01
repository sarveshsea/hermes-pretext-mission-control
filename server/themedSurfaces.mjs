import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { appendHermesEvent } from "./hermesEvents.mjs";
import { safeSnippet } from "./redaction.mjs";

const SURFACES = ["design_lab", "sports_radar", "buzzr_drafts", "design_library"];
const STORE_DIR = path.join(ROOTS.project, "data/themed");
const MAX_PER_SURFACE = 60;

let cache = new Map();

function storePath(surface) {
  return path.join(STORE_DIR, `${surface}.json`);
}

async function load(surface) {
  if (cache.has(surface)) return cache.get(surface);
  try {
    const text = await fs.readFile(storePath(surface), "utf8");
    const parsed = JSON.parse(text);
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    cache.set(surface, items);
    return items;
  } catch {
    cache.set(surface, []);
    return [];
  }
}

async function persist(surface) {
  const items = cache.get(surface) || [];
  await fs.mkdir(path.dirname(storePath(surface)), { recursive: true });
  await fs.writeFile(storePath(surface), JSON.stringify({ items: items.slice(-MAX_PER_SURFACE) }, null, 2), "utf8");
}

function newId(now, surface) {
  return `${surface}_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function shapePayload(surface, input) {
  const now = new Date();
  const base = {
    id: newId(now, surface),
    createdAt: now.toISOString(),
    surface
  };
  switch (surface) {
    case "design_lab":
      return {
        ...base,
        title: safeSnippet(input.title || "untitled experiment", 200),
        description: safeSnippet(input.description || "", 1200),
        previewCss: input.previewCss ? safeSnippet(String(input.previewCss), 4000) : null,
        appliesTo: safeSnippet(input.appliesTo || "", 200),
        sourceProposalId: input.sourceProposalId ? String(input.sourceProposalId).slice(0, 80) : null
      };
    case "sports_radar":
      if (input.kind === "headline") {
        return {
          ...base,
          kind: "headline",
          league: safeSnippet(input.league || "general", 80),
          source: safeSnippet(input.source || "", 200),
          headline: safeSnippet(input.headline || "", 400),
          link: safeSnippet(input.link || "", 400)
        };
      }
      if (input.kind === "commentator_tweet") {
        return {
          ...base,
          kind: "commentator_tweet",
          handle: safeSnippet(input.handle || "", 80),
          name: safeSnippet(input.name || "", 120),
          text: safeSnippet(input.text || "", 800),
          link: safeSnippet(input.link || "", 400)
        };
      }
      return { ...base, kind: "note", text: safeSnippet(input.text || "", 600) };
    case "buzzr_drafts":
      return {
        ...base,
        text: safeSnippet(input.text || "", 600),
        audience: safeSnippet(input.audience || "x.com followers", 200),
        hashtags: Array.isArray(input.hashtags) ? input.hashtags.slice(0, 8).map((tag) => safeSnippet(String(tag), 40)) : [],
        worstCase: safeSnippet(input.worstCase || "", 400),
        publicIntentId: input.publicIntentId ? String(input.publicIntentId).slice(0, 80) : null
      };
    case "design_library":
      return {
        ...base,
        title: safeSnippet(input.title || "untitled pattern", 200),
        sourceUrl: safeSnippet(input.sourceUrl || "", 400),
        summary: safeSnippet(input.summary || "", 1600),
        appliesTo: safeSnippet(input.appliesTo || "", 200),
        notePath: safeSnippet(input.notePath || "", 400)
      };
    default:
      return { ...base, raw: safeSnippet(JSON.stringify(input).slice(0, 1200)) };
  }
}

export async function postThemedItem(surface, input = {}) {
  if (!SURFACES.includes(surface)) {
    const error = new Error(`Unknown surface: ${surface}`);
    error.status = 400;
    throw error;
  }
  await load(surface);
  const item = shapePayload(surface, input);
  const items = cache.get(surface);
  items.push(item);
  if (items.length > MAX_PER_SURFACE) items.splice(0, items.length - MAX_PER_SURFACE);
  await persist(surface);
  await appendHermesEvent({
    type:
      surface === "buzzr_drafts"
        ? "buzzr_draft"
        : surface === "design_lab"
          ? "design_experiment"
          : surface === "design_library"
            ? "design_pattern"
            : item.kind === "commentator_tweet"
              ? "commentator_tweet"
              : "sports_headline",
    role: "assistant",
    content: safeSnippet(item.title || item.headline || item.text || "", 240),
    extra: { surface, id: item.id }
  });
  return item;
}

export async function getThemedItems(surface, limit = 20) {
  if (!SURFACES.includes(surface)) {
    const error = new Error(`Unknown surface: ${surface}`);
    error.status = 400;
    throw error;
  }
  const items = await load(surface);
  return items.slice(-limit).reverse();
}

export async function getAllThemedSummaries() {
  const out = {};
  for (const surface of SURFACES) {
    const items = await load(surface);
    out[surface] = {
      count: items.length,
      latest: items.slice(-6).reverse()
    };
  }
  return out;
}

export const THEMED_SURFACES = SURFACES;
