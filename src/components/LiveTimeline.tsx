import { useEffect, useMemo, useRef } from "react";
import type { HermesEvent } from "../api";

type Props = {
  events: HermesEvent[];
  onSelect: (e: HermesEvent) => void;
};

// Vertical scrolling timeline — newest at top, freezes scroll on hover so the
// operator can read recent decisions, click any row to open the InspectorOverlay.
// Color-coded by phase outcome (chartreuse=ship, amber=abandon, lavender=think).
const PHASE_TONE: Record<string, string> = {
  pickTask: "tone-pick",
  concretize: "tone-concretize",
  search: "tone-search",
  playbook: "tone-playbook",
  submit: "tone-submit",
  abandon: "tone-abandon",
  planAdvance: "tone-plan"
};

function classifyEvent(e: HermesEvent): { tone: string; phase: string; body: string } {
  if (e.type === "pipeline_step") {
    const m = (e.content || "").match(/^\[([a-zA-Z]+)\]\s*(.*)/);
    const phase = m?.[1] || "step";
    const body = m?.[2] || e.content || "";
    return { tone: PHASE_TONE[phase] || "tone-step", phase, body };
  }
  if (e.type === "thinking") {
    const cleaned = (e.content || "").replace(/^\[[^\]]+\]\s*/, "");
    return { tone: "tone-thinking", phase: "think", body: cleaned };
  }
  if (e.type === "model_call") {
    const cleaned = (e.content || "").replace(/^\[[^\]]+\]\s*/, "");
    return { tone: "tone-model", phase: "model", body: cleaned };
  }
  if (e.type === "mission_update") {
    return { tone: "tone-mission", phase: "mission", body: e.content || "" };
  }
  if (e.type === "error") {
    return { tone: "tone-error", phase: "error", body: e.content || "" };
  }
  return { tone: "tone-other", phase: e.type, body: e.content || "" };
}

export default function LiveTimeline({ events, onSelect }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const filtered = useMemo(
    () => events.filter((e) =>
      ["pipeline_step", "thinking", "model_call", "mission_update", "error", "memory_write"].includes(e.type)
    ).slice(0, 60),
    [events]
  );

  // Only auto-scroll if user isn't hovering (prevents jumpy reads).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!el.matches(":hover")) {
      el.scrollTop = 0;
    }
  }, [filtered]);

  return (
    <div className="live-timeline-wrap">
      <div className="live-timeline-head">
        <span className="live-timeline-label">LIVE TIMELINE</span>
        <span className="live-timeline-count muted">{filtered.length} events</span>
      </div>
      <div className="live-timeline" ref={ref} role="log" aria-live="polite">
        {filtered.length === 0 ? (
          <div className="muted">agent quiet · no recent decisions</div>
        ) : (
          filtered.map((e) => {
            const { tone, phase, body } = classifyEvent(e);
            return (
              <button
                key={e.id}
                className={`tl-row ${tone}`}
                onClick={() => onSelect(e)}
                title={body}
              >
                <span className="tl-time">{e.createdAt.slice(11, 19)}</span>
                <span className="tl-phase">{phase}</span>
                <span className="tl-body">{body}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
