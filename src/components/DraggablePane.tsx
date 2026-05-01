import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { snap, type PanePosition } from "../layout";

type Props = {
  id: string;
  position: PanePosition;
  onPositionChange: (id: string, position: PanePosition) => void;
  onFocus?: (id: string) => void;
  title?: string;
  accent?: string;
  children: ReactNode;
};

export default function DraggablePane({
  id,
  position,
  onPositionChange,
  onFocus,
  title,
  accent,
  children
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const offsetRef = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Only start drag from the pane header (data-drag-handle="true")
      const target = event.target as HTMLElement;
      if (!target.closest('[data-drag-handle="true"]')) return;
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      offsetRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      setDragging(true);
      onFocus?.(id);
      try {
        (event.target as HTMLElement).setPointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    },
    [id, onFocus]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging || !offsetRef.current) return;
      const x = snap(event.clientX - offsetRef.current.x);
      const y = snap(event.clientY - offsetRef.current.y);
      onPositionChange(id, { ...position, x: Math.max(0, x), y: Math.max(0, y) });
    },
    [dragging, id, onPositionChange, position]
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      setDragging(false);
      offsetRef.current = null;
      try {
        (event.target as HTMLElement).releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    },
    [dragging]
  );

  // Esc cancels drag (revert)
  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDragging(false);
        offsetRef.current = null;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dragging]);

  return (
    <div
      ref={ref}
      className={`pane ${dragging ? "pane-dragging" : ""}`}
      style={{
        left: position.x,
        top: position.y,
        width: position.w,
        height: position.h,
        zIndex: dragging ? 200 : position.z ?? 10,
        borderColor: accent
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      data-pane-id={id}
    >
      {title ? (
        <header className="pane-header" data-drag-handle="true">
          <span className="pane-title" style={{ color: accent }}>
            {title}
          </span>
          <span className="pane-grip" aria-hidden>
            ⋮⋮
          </span>
        </header>
      ) : null}
      <div className="pane-body">{children}</div>
    </div>
  );
}
