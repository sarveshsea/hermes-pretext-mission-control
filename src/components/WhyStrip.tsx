import { useEffect, useState } from "react";

type Summaries = {
  pipeline?: string;
  thinking?: string;
  swarm?: string;
};

type Dots = Record<string, "green" | "amber" | "red">;

export default function WhyStrip() {
  const [summaries, setSummaries] = useState<Summaries>({});
  const [dots, setDots] = useState<Dots>({});

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/hermes/pane-summaries", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setSummaries(data.summaries || {});
          setDots(data.dots || {});
        }
      } catch {
        // best-effort
      }
    };
    void tick();
    const id = setInterval(tick, 6_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="why-strip" data-testid="why-strip">
      <div className="why-cell why-thinking">
        <span className="why-label">THINKING</span>
        <span className={`why-dot why-dot-${dots.thinking || "amber"}`} aria-hidden>●</span>
        <span className="why-content">{summaries.thinking || "—"}</span>
      </div>
      <div className="why-cell why-pipeline">
        <span className="why-label">PIPELINE</span>
        <span className={`why-dot why-dot-${dots.pipeline || "amber"}`} aria-hidden>●</span>
        <span className="why-content">{summaries.pipeline || "—"}</span>
      </div>
      <div className="why-cell why-swarm">
        <span className="why-label">SWARM</span>
        <span className={`why-dot why-dot-${dots.swarm || "amber"}`} aria-hidden>●</span>
        <span className="why-content">{summaries.swarm || "—"}</span>
      </div>
    </div>
  );
}
