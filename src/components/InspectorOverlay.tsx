import { useEffect } from "react";
import type { HermesEvent } from "../api";

type Props = {
  event: HermesEvent | null;
  onClose: () => void;
};

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

  const copy = () => {
    void navigator.clipboard?.writeText(JSON.stringify(event, null, 2));
  };

  return (
    <div className="inspector-overlay" onClick={onClose}>
      <div className="inspector-card" onClick={(e) => e.stopPropagation()}>
        <header>
          <strong>{event.type.toUpperCase()}</strong>
          <span className="muted">
            {event.role || "—"} · {event.createdAt}
          </span>
          <button onClick={copy} className="button button-mini button-light">copy</button>
          <button onClick={onClose} className="button button-mini button-light">close</button>
        </header>
        <section className="inspector-body">
          <pre>{event.content || "(empty content)"}</pre>
          <div className="kv">
            <div className="kv-row">
              <span className="kv-key">id</span>
              <span className="kv-val">{event.id}</span>
            </div>
            {event.model && (
              <div className="kv-row">
                <span className="kv-key">model</span>
                <span className="kv-val">{event.model}</span>
              </div>
            )}
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
            {event.extra && (
              <div className="kv-row">
                <span className="kv-key">extra</span>
                <pre className="kv-val muted">{JSON.stringify(event.extra, null, 2)}</pre>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
