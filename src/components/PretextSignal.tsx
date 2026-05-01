import { useEffect, useMemo, useRef } from "react";
import { layoutWithLines, prepareWithSegments } from "@chenglou/pretext";
import type { Learning, ProjectSummary, ReviewQueue } from "../api";

type Props = {
  learnings: Learning[];
  projects: ProjectSummary[];
  reviewQueues: ReviewQueue[];
};

function buildCorpus(learnings: Learning[], projects: ProjectSummary[], reviewQueues: ReviewQueue[]) {
  const learningText = learnings
    .slice(0, 4)
    .map((item) => `${item.title}: ${item.snippet}`)
    .join(" ");
  const projectText = projects
    .filter((project) => project.riskFlags.length || project.git?.changedFiles)
    .slice(0, 5)
    .map((project) => `${project.name} signal ${project.riskFlags.join(", ") || "ready"}`)
    .join(" ");
  const queueText = reviewQueues
    .slice(0, 5)
    .map((queue) => `${queue.name} has ${queue.openTaskCount} open tasks`)
    .join(" ");
  return [learningText, projectText, queueText]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export default function PretextSignal({ learnings, projects, reviewQueues }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const corpus = useMemo(
    () =>
      buildCorpus(learnings, projects, reviewQueues) ||
      "Hermes is online. Review queues are connected. Project signals are flowing into Mission Control.",
    [learnings, projects, reviewQueues]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let frame = 0;
    let raf = 0;
    const font = "17px Inter, ui-sans-serif, system-ui, sans-serif";
    const prepared = prepareWithSegments(corpus, font);

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);

      const gradient = context.createLinearGradient(0, 0, rect.width, rect.height);
      gradient.addColorStop(0, "rgba(224, 246, 255, 0.95)");
      gradient.addColorStop(0.52, "rgba(208, 241, 0, 0.9)");
      gradient.addColorStop(1, "rgba(95, 189, 247, 0.86)");

      context.fillStyle = "rgba(224, 246, 255, 0.10)";
      for (let x = 10; x < rect.width; x += 18) {
        for (let y = 10; y < rect.height; y += 18) {
          const pulse = Math.sin(frame * 0.018 + x * 0.035 + y * 0.025);
          context.globalAlpha = 0.22 + pulse * 0.08;
          context.beginPath();
          context.arc(x, y, 1.15, 0, Math.PI * 2);
          context.fill();
        }
      }

      context.globalAlpha = 1;
      context.font = font;
      context.textBaseline = "top";
      const maxWidth = Math.max(280, rect.width - 48);
      const layoutResult = layoutWithLines(prepared, maxWidth, 28);
      context.fillStyle = gradient;
      layoutResult.lines.slice(0, 8).forEach((line, index) => {
        const x = 24 + Math.sin(frame * 0.018 + index * 0.8) * 8;
        const y = 26 + index * 30 + Math.cos(frame * 0.014 + index) * 3;
        context.globalAlpha = 0.98 - index * 0.075;
        context.fillText(line.text, x, y);
      });
      context.globalAlpha = 1;

      frame += 1;
      raf = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, [corpus]);

  return <canvas ref={canvasRef} className="signal-canvas" aria-label="Hermes learning signal" />;
}
