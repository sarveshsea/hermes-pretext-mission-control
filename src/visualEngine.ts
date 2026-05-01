import type { HermesEvent, HermesEventType } from "./api";

export type Vec2 = { x: number; y: number };

export type Particle = {
  type: HermesEventType;
  from: Vec2;
  to: Vec2;
  birth: number;
  ttl: number;
  hue: string;
  payload: string;
};

export type EdgeKey = string;

export type NodePulse = {
  node: string;
  level: number;
};

const HUE: Record<HermesEventType, string> = {
  telegram_in: "rgba(208, 241, 0, 0.95)",
  telegram_out: "rgba(208, 241, 0, 0.78)",
  model_call: "rgba(140, 200, 255, 0.92)",
  model_result: "rgba(140, 200, 255, 0.72)",
  tool_call: "rgba(255, 224, 140, 0.88)",
  tool_result: "rgba(255, 224, 140, 0.65)",
  iteration_tick: "rgba(180, 200, 240, 0.55)",
  error: "rgba(255, 130, 130, 0.95)",
  public_intent: "rgba(255, 200, 120, 0.95)",
  public_action: "rgba(255, 200, 120, 0.75)",
  run_request: "rgba(208, 241, 0, 0.82)",
  run_chunk: "rgba(180, 220, 255, 0.45)",
  run_result: "rgba(208, 241, 0, 0.9)",
  thinking: "rgba(180, 160, 255, 0.85)",
  mission_start: "rgba(208, 241, 0, 0.9)",
  mission_update: "rgba(208, 241, 0, 0.7)",
  memory_read: "rgba(160, 240, 200, 0.82)",
  memory_write: "rgba(160, 240, 200, 0.95)",
  note: "rgba(224, 246, 255, 0.55)"
};

export function colorFor(type: HermesEventType): string {
  return HUE[type] || "rgba(224, 246, 255, 0.6)";
}

export function eventTrajectory(type: HermesEventType): { source: string; target: string } {
  switch (type) {
    case "telegram_in":
      return { source: "local-console", target: "hermes" };
    case "telegram_out":
      return { source: "hermes", target: "local-console" };
    case "model_call":
    case "model_result":
    case "thinking":
      return { source: "hermes", target: "projects" };
    case "tool_call":
    case "tool_result":
      return { source: "hermes", target: "builder" };
    case "run_request":
    case "run_chunk":
    case "run_result":
      return { source: "builder", target: "run-queue" };
    case "memory_read":
      return { source: "obsidian", target: "hermes" };
    case "memory_write":
      return { source: "hermes", target: "obsidian" };
    case "public_intent":
    case "public_action":
      return { source: "hermes", target: "design-memory" };
    case "mission_start":
    case "mission_update":
      return { source: "hermes", target: "projects" };
    case "iteration_tick":
      return { source: "hermes", target: "hermes" };
    case "error":
      return { source: "hermes", target: "run-queue" };
    case "note":
    default:
      return { source: "hermes", target: "obsidian" };
  }
}

export function edgeKey(a: string, b: string): EdgeKey {
  return [a, b].sort().join(":");
}

export function spawnParticle(
  event: HermesEvent,
  resolveNode: (id: string) => Vec2 | null,
  now = Date.now()
): Particle | null {
  const traj = eventTrajectory(event.type);
  const from = resolveNode(traj.source);
  const to = resolveNode(traj.target);
  if (!from || !to) return null;
  return {
    type: event.type,
    from,
    to,
    birth: now,
    ttl: event.type === "error" ? 2400 : 1500,
    hue: colorFor(event.type),
    payload: (event.content || "").slice(0, 24)
  };
}

export function drawParticle(ctx: CanvasRenderingContext2D, particle: Particle, now: number) {
  const t = (now - particle.birth) / particle.ttl;
  if (t >= 1) return false;
  const ease = 1 - Math.pow(1 - t, 2.4);
  const x = particle.from.x + (particle.to.x - particle.from.x) * ease;
  const y = particle.from.y + (particle.to.y - particle.from.y) * ease;
  const trailLen = Math.max(8, 32 * (1 - t));
  const dx = particle.to.x - particle.from.x;
  const dy = particle.to.y - particle.from.y;
  const mag = Math.hypot(dx, dy) || 1;
  const tailX = x - (dx / mag) * trailLen;
  const tailY = y - (dy / mag) * trailLen;

  const gradient = ctx.createLinearGradient(tailX, tailY, x, y);
  gradient.addColorStop(0, particle.hue.replace(/[\d.]+\)/, "0)"));
  gradient.addColorStop(0.7, particle.hue);
  gradient.addColorStop(1, "rgba(255,255,255,0.95)");
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 1.6 + 1.2 * (1 - t);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(tailX, tailY);
  ctx.lineTo(x, y);
  ctx.stroke();

  ctx.fillStyle = particle.hue;
  ctx.beginPath();
  ctx.arc(x, y, 2.2 + 1.4 * (1 - t), 0, Math.PI * 2);
  ctx.fill();
  return true;
}

const COLUMN_FONT = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

export type MatrixRainState = {
  columns: { x: number; y: number; speed: number; chars: string[] }[];
  width: number;
  height: number;
};

const MATRIX_GLYPHS = "01アイウエオカキクケコサシスセソタチツテトナニヌネノ░▒▓█▌▐│┤╣║╗╝┐└┴┬├─┼".split("");

export function buildMatrixRain(width: number, height: number): MatrixRainState {
  const colWidth = 18;
  const colCount = Math.max(8, Math.floor(width / colWidth));
  const rowCount = Math.max(20, Math.floor(height / 16));
  const columns = Array.from({ length: colCount }, (_, idx) => ({
    x: idx * colWidth + 6,
    y: Math.random() * height,
    speed: 0.3 + Math.random() * 1.1,
    chars: Array.from({ length: rowCount }, () => MATRIX_GLYPHS[Math.floor(Math.random() * MATRIX_GLYPHS.length)])
  }));
  return { columns, width, height };
}

export function drawMatrixRain(
  ctx: CanvasRenderingContext2D,
  state: MatrixRainState,
  density: number
) {
  ctx.font = COLUMN_FONT;
  ctx.textBaseline = "top";
  const tint = Math.min(0.22, 0.06 + density * 0.12);
  state.columns.forEach((col) => {
    col.y += col.speed * (0.5 + density * 0.8);
    if (col.y > state.height + 80) col.y = -80 - Math.random() * 120;
    const baseY = col.y;
    col.chars.forEach((char, idx) => {
      const y = baseY - idx * 16;
      if (y < -16 || y > state.height + 16) return;
      const alpha = idx === 0 ? tint + 0.18 : tint * (1 - idx / col.chars.length);
      ctx.fillStyle = idx === 0
        ? `rgba(208, 241, 0, ${Math.min(0.85, alpha)})`
        : `rgba(140, 200, 255, ${Math.max(0.02, alpha)})`;
      ctx.fillText(char, col.x, y);
    });
  });
}

export function decay(value: number, dt: number, halfLife = 600): number {
  return value * Math.pow(0.5, dt / halfLife);
}
