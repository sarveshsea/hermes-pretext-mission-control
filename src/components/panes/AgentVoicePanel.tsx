import { useEffect, useState } from "react";
import type { HermesEvent } from "../../api";

type Props = {
  events: HermesEvent[];
  onSelect: (event: HermesEvent) => void;
};

// Streams the agent's recent THINKING + PIPELINE_STEP events as a
// chat-log-style narrative. Lets the operator hear the agent in its own
// voice without scrolling the dense HERMES_LIVE feed. Replaces CODE_SEARCH
// in the bento — much higher narrative signal.
export default function AgentVoicePanel({ events, onSelect }: Props) {
  const [showOnly, setShowOnly] = useState<"all" | "thinking" | "pipeline">("all");

  const filtered = events.filter((e) => {
    if (showOnly === "thinking") return e.type === "thinking";
    if (showOnly === "pipeline") return e.type === "pipeline_step";
    return e.type === "thinking" || e.type === "pipeline_step";
  }).slice(0, 18);

  return (
    <div className="agent-voice" data-testid="pane-agent-voice">
      <div className="agent-voice-tabs">
        <button
          className={`agent-voice-tab ${showOnly === "all" ? "active" : ""}`}
          onClick={() => setShowOnly("all")}
        >
          ALL
        </button>
        <button
          className={`agent-voice-tab ${showOnly === "thinking" ? "active" : ""}`}
          onClick={() => setShowOnly("thinking")}
        >
          THINKING
        </button>
        <button
          className={`agent-voice-tab ${showOnly === "pipeline" ? "active" : ""}`}
          onClick={() => setShowOnly("pipeline")}
        >
          PIPELINE
        </button>
      </div>
      {filtered.length === 0 ? (
        <div className="muted">agent quiet · no recent thinking or pipeline events</div>
      ) : (
        <ul className="agent-voice-list">
          {filtered.map((e) => {
            const tone = e.type === "thinking" ? "voice-thinking" : "voice-pipeline";
            const label = e.type === "thinking" ? "THINK" : "STEP";
            return (
              <li key={e.id} className={`agent-voice-row ${tone}`} onClick={() => onSelect(e)}>
                <span className="agent-voice-time">{e.createdAt.slice(11, 19)}</span>
                <span className={`agent-voice-tag agent-voice-tag-${e.type}`}>{label}</span>
                <span className="agent-voice-text" title={e.content}>{e.content}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
