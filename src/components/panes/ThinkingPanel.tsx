import { useEffect, useMemo, useRef } from "react";
import { layoutWithLines, prepareWithSegments } from "@chenglou/pretext";
import type { MissionState } from "../../api";

type Props = { mission: MissionState };

const FONT = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

export default function ThinkingPanel({ mission }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const text = useMemo(
    () =>
      (mission?.thinking || [])
        .slice(0, 6)
        .map((t) => `· ${t.content}`)
        .join("  "),
    [mission]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, rect.width * dpr);
      canvas.height = Math.max(1, rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      const prepared = prepareWithSegments(text || "no recent reasoning", FONT);
      const layout = layoutWithLines(prepared, Math.max(120, rect.width - 16), 14);
      ctx.font = FONT;
      ctx.textBaseline = "top";
      layout.lines.slice(0, 8).forEach((line, idx) => {
        ctx.fillStyle = idx === 0 ? "rgba(225, 218, 255, 0.95)" : "rgba(225, 218, 255, 0.7)";
        ctx.fillText(line.text, 8, 4 + idx * 14);
      });
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [text]);

  return <canvas ref={canvasRef} className="thinking-canvas" />;
}
