import { useEffect } from "react";
import type { HermesEvent } from "../api";

type Props = {
  event: HermesEvent | null;
  onClose: () => void;
};

type Extra = Record<string, unknown> & {
  prompt?: string;
  output?: string;
  parseResult?: unknown;
  latencyMs?: number;
  model?: string;
  playbook?: string;
  proposalId?: string;
};

function formatLatency(ms?: number): string {
  if (typeof ms !== "number") return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export default function InspectorOverlay({ event, onClose }: Props) {
  useEffect(() => {
    if (!event) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [event, onClose]);

  useEffect(() => {
    if (!event) return;
    history.replaceState(null, "", `#event=${event.id}`);
    return () => {
      history.replaceState(null, "", window.location.pathname);
    };
  }, [event]);

  if (!event) return null;

  const extra = (event.extra || {}) as Extra;
  const isDecision = event.type === "pipeline_step" || event.type === "model_call" || event.type === "model_result";

  const copy = () => {
    void navigator.clipboard?.writeText(JSON.stringify(event, null, 2));
  };

  return (
    <div className="inspector-overlay" onClick={onClose}>
      <div
        className={`inspector-card ${isDecision ? "inspector-decision" : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Event inspector"
      >
        <header>
          <strong>{event.type.toUpperCase()}</strong>
          <span className="muted">{event.role || "—"} · {event.createdAt.slice(11, 19)}</span>
          {extra.latencyMs ? <span className="inspector-latency">{formatLatency(extra.latencyMs)}</span> : null}
          {extra.model || event.model ? (
            <span className="inspector-model">{String(extra.model || event.model)}</span>
          ) : null}
          <button onClick={copy} className="button button-mini button-light">copy</button>
          <button onClick={onClose} className="button button-mini button-light" aria-label="close">close</button>
        </header>

        <section className="inspector-body">
          {isDecision && (extra.prompt || extra.output) ? (
            <>
              <div className="inspector-section">
                <div className="inspector-section-label">CONTENT</div>
                <pre>{event.content || "(empty)"}</pre>
              </div>
              {typeof extra.prompt === "string" && extra.prompt.length > 0 ? (
                <div className="inspector-section">
                  <div className="inspector-section-label">PROMPT</div>
                  <pre className="inspector-pre-scroll">{extra.prompt}</pre>
                </div>
              ) : null}
              {typeof extra.output === "string" && extra.output.length > 0 ? (
                <div className="inspector-section">
                  <div className="inspector-section-label">RAW MODEL OUTPUT</div>
                  <pre className="inspector-pre-scroll">{extra.output}</pre>
                </div>
              ) : null}
              {extra.parseResult !== undefined ? (
                <div className="inspector-section">
                  <div className="inspector-section-label">PARSED</div>
                  <pre className="inspector-pre-scroll">{JSON.stringify(extra.parseResult, null, 2)}</pre>
                </div>
              ) : null}
            </>
          ) : (
            <pre>{event.content || "(empty content)"}</pre>
          )}
          <div className="kv">
            <div className="kv-row">
              <span className="kv-key">id</span>
              <span className="kv-val">{event.id}</span>
            </div>
            {event.iteration != null && (
              <div className="kv-row">
                <span className="kv-key">iteration</span>
                <span className="kv-val">{event.iteration}</span>
              </div>
            )}
            {event.sessionId && (
              <div className="kv-row">
                <span className="kv-key">session</span>
                <span className="kv-val">{event.sessionId}</span>
              </div>
            )}
            {event.intent && (
              <div className="kv-row">
                <span className="kv-key">intent</span>
                <span className="kv-val">{event.intent}</span>
              </div>
            )}
            {extra.playbook ? (
              <div className="kv-row">
                <span className="kv-key">playbook</span>
                <span className="kv-val">{String(extra.playbook)}</span>
              </div>
            ) : null}
            {extra.proposalId ? (
              <div className="kv-row">
                <span className="kv-key">proposal</span>
                <span className="kv-val">{String(extra.proposalId)}</span>
              </div>
            ) : null}
            {Object.keys(extra).length > 0 && (
              <div className="kv-row">
                <span className="kv-key">extra</span>
                <pre className="kv-val muted">{JSON.stringify(extra, null, 2)}</pre>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
