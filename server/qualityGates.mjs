// Quality gates for themed-surface outputs. Reject generic slop BEFORE it
// lands in the canonical pane. Failed outputs go to data/drafts/<surface>.jsonl
// where Sarvesh can see what the agent tried and why it didn't pass.
//
// Gates are intentionally simple — token checks + length floors. They keep
// out the obvious "Tired of X? Buzzr is the answer for Y!" template slop
// without requiring a second LLM pass.

import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { appendHermesEvent } from "./hermesEvents.mjs";

const DRAFTS_DIR = path.join(ROOTS.project, "data/drafts");

// Lazy openers / clichés that trigger rejection.
const BUZZR_BLACKLIST = [
  /\btired of\b/i,
  /\bbuzzr is\b/i,
  /\bget ready\b/i,
  /\bgame[- ]changer\b/i,
  /\brevolutioniz/i,
  /\bnext[- ]level\b/i,
  /\bunlock the power\b/i,
  /\bjoin the conversation\b/i,
  /\b#sportstweet\b/i
];

const BUZZR_COMMUNITIES = [
  // NCAA conference fans
  /\bACC\b/i, /\bSEC\b/i, /\bBig (?:10|Ten|12)\b/i, /\bPac[- ]?12\b/i,
  // NHL niche
  /\bIslanders?\b/i, /\bSenators?\b/i, /\bCoyotes?\b/i, /\bUtah Hockey\b/i, /\bKraken\b/i,
  // MLS supporter groups + niche
  /\bSounders?\b/i, /\bTimbers Army\b/i, /\bScreaming Eagles\b/i, /\bDC United\b/i, /\bCharlotte FC\b/i,
  // NBA niche
  /\bSpurs Twitter\b/i, /\bGrizzGang\b/i, /\bRipCity\b/i, /\bMagic\b/i, /\bHornets?\b/i,
  // NFL fanbases
  /\bDawg Pound\b/i, /\bCheeseheads?\b/i, /\bBills Mafia\b/i, /\bWhoDats?\b/i, /\b12s\b/i, /\bRaiders?\b/i,
  // generic micro-community signal
  /\bsupporter group\b/i, /\bfan club\b/i, /\bdiehards?\b/i
];

export function validateBuzzrDraft({ text, audience } = {}) {
  if (!text || typeof text !== "string") return { ok: false, reason: "empty text" };
  const t = text.trim();
  if (t.length < 40) return { ok: false, reason: `too short (${t.length} chars; min 40)` };
  if (t.length > 220) return { ok: false, reason: `too long (${t.length} chars; max 220)` };
  for (const re of BUZZR_BLACKLIST) {
    if (re.test(t)) return { ok: false, reason: `lazy opener/cliché: matched ${re}` };
  }
  const hasCommunity = BUZZR_COMMUNITIES.some((re) => re.test(t)) || /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/.test(t);
  if (!hasCommunity) return { ok: false, reason: "no specific community/team/player named" };
  // Must contain an actual point — at least one substantive verb-phrase.
  if (!/\b(?:built|made|playing|scored|loses?|missed|deserve|trades?|signs?|drafted|leads?|chasing|stuck)\b/i.test(t)) {
    return { ok: false, reason: "no concrete action/storyline verb" };
  }
  return { ok: true };
}

const DESIGN_AUDIT_SECTIONS = [
  /posture/i, /color/i, /typograph/i, /spacing/i, /motion/i, /component/i, /borrow/i, /reject/i
];
const HEX_RE = /#[0-9a-f]{3,8}\b/i;

export function validateDesignAudit({ markdown, slug } = {}) {
  if (!markdown || typeof markdown !== "string") return { ok: false, reason: "empty markdown" };
  if (markdown.length < 800) return { ok: false, reason: `too short (${markdown.length} chars; min 800)` };
  const sectionsHit = DESIGN_AUDIT_SECTIONS.filter((re) => re.test(markdown)).length;
  if (sectionsHit < 6) return { ok: false, reason: `only ${sectionsHit}/8 sections present (need ≥6)` };
  if (!HEX_RE.test(markdown)) return { ok: false, reason: "no hex codes or token references" };
  if (!slug || slug.length < 2) return { ok: false, reason: "missing slug" };
  return { ok: true };
}

export function validateMemoireAudit({ source, summary, fullText } = {}) {
  const text = fullText || summary || "";
  if (!source) return { ok: false, reason: "missing source app name" };
  if (!text || text.length < 200) return { ok: false, reason: `summary too short (${text.length} chars; min 200)` };
  if (!/memoire/i.test(text)) return { ok: false, reason: "no Memoire-specific learning" };
  // 3+ specific design moves: bullet-style or numbered
  const bullets = (text.match(/^\s*[-*•\d]/gm) || []).length;
  if (bullets < 3) return { ok: false, reason: `only ${bullets} bullet/numbered items (need ≥3)` };
  return { ok: true };
}

const KNOWN_TEAMS = [
  "Lakers", "Celtics", "Warriors", "Bulls", "Heat", "Nuggets", "Mavericks", "Suns", "Knicks",
  "Cowboys", "Patriots", "49ers", "Eagles", "Bills", "Chiefs", "Lions", "Packers",
  "Yankees", "Dodgers", "Astros", "Mets", "Phillies", "Braves",
  "Rangers", "Stars", "Bruins", "Avalanche",
  "Inter Miami", "LAFC", "Sounders", "Atlanta United",
  "Alabama", "Georgia", "Ohio State", "Michigan", "Texas", "Notre Dame", "USC",
  "UConn", "Duke", "Kentucky", "North Carolina", "Kansas"
];

export function validateSportsHeadline({ headline, league, source } = {}) {
  if (!headline || typeof headline !== "string") return { ok: false, reason: "empty headline" };
  const t = headline.trim();
  if (t.length < 30) return { ok: false, reason: `too short (${t.length}; min 30)` };
  if (t.length > 200) return { ok: false, reason: `too long (${t.length}; max 200)` };
  const hasTeam = KNOWN_TEAMS.some((team) => t.includes(team));
  const hasPlayerName = /\b[A-Z][a-z]+\s+[A-Z][a-z]+/.test(t);
  if (!hasTeam && !hasPlayerName) return { ok: false, reason: "no recognized team or two-name player" };
  if (/^\d/.test(t.split(" ")[0]) && /^\d/.test(t.split(" ")[1] || "")) return { ok: false, reason: "stat blob, not a storyline" };
  return { ok: true };
}

// Append to draft pool when output fails the gate. The DraftPoolPanel reads
// these to show "what the agent tried, why it didn't pass."
export async function appendDraft(surface, payload, reason) {
  try {
    await fs.mkdir(DRAFTS_DIR, { recursive: true });
    const file = path.join(DRAFTS_DIR, `${surface}.jsonl`);
    const line = JSON.stringify({ ts: new Date().toISOString(), surface, reason, payload }) + "\n";
    await fs.appendFile(file, line, "utf8");
    await appendHermesEvent({
      type: "note",
      role: "system",
      content: `[draft-pool] ${surface}: ${reason}`,
      extra: { surface, reason }
    });
  } catch {
    // best-effort
  }
}

// Read recent drafts for the dashboard pane.
export async function readDrafts({ limit = 30 } = {}) {
  const surfaces = ["buzzr_drafts", "sports_radar", "design_lab", "design_library", "memoire_audits"];
  const out = {};
  for (const surface of surfaces) {
    const file = path.join(DRAFTS_DIR, `${surface}.jsonl`);
    try {
      const text = await fs.readFile(file, "utf8");
      const lines = text.split("\n").filter(Boolean).slice(-limit);
      out[surface] = lines.map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
    } catch {
      out[surface] = [];
    }
  }
  return out;
}
