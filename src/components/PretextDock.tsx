import { useEffect, useMemo, useRef } from "react";
import { layoutWithLines, prepareWithSegments } from "@chenglou/pretext";
import { buildComposerLines } from "../composerModel";

type Props = {
  mode: "message" | "command";
  value: string;
  detail?: string;
  busy: boolean;
};

export default function PretextDock({ mode, value, detail, busy }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lines = useMemo(() => buildComposerLines({ mode, value, detail, busy }), [busy, detail, mode, value]);
  const text = lines.join(" ");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let frame = 0;
    let raf = 0;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);

      context.fillStyle = "rgba(0, 16, 51, 0.78)";
      context.fillRect(0, 0, rect.width, rect.height);
      context.strokeStyle = mode === "message" ? "rgba(208, 241, 0, 0.42)" : "rgba(224, 246, 255, 0.26)";
      context.strokeRect(0.5, 0.5, rect.width - 1, rect.height - 1);

      context.fillStyle = "rgba(224, 246, 255, 0.08)";
      for (let x = 12; x < rect.width; x += 28) {
        const y = 15 + Math.sin(frame * 0.02 + x * 0.08) * 2;
        context.fillText(mode === "message" ? "@" : "$", x, y);
      }

      const prepared = prepareWithSegments(text, "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace");
      const layout = layoutWithLines(prepared, Math.max(200, rect.width - 28), 18);
      context.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      context.textBaseline = "top";
      layout.lines.slice(0, mode === "message" ? 2 : 3).forEach((line, index) => {
        context.fillStyle =
          index === 0 ? "rgba(208, 241, 0, 0.96)" : mode === "message" ? "#fafeff" : "rgba(224, 246, 255, 0.78)";
        context.fillText(index === 0 ? line.text : `  ${line.text}`, 14, 10 + index * 18);
      });

      frame += 1;
      raf = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, [lines, mode, text]);

  return <canvas className="pretext-dock-canvas" ref={canvasRef} aria-hidden="true" />;
}
