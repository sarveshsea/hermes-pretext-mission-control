import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_PANE_POSITIONS,
  cacheLayout,
  fetchServerLayout,
  loadCachedLayout,
  mergeLayout,
  persistServerLayout,
  type LayoutMap,
  type LayoutSnapshot,
  type PanePosition
} from "../layout";

type RenderFn = (id: string, position: PanePosition, onPositionChange: (id: string, p: PanePosition) => void, onFocus: (id: string) => void) => ReactNode;

type Props = {
  paneIds: string[];
  render: RenderFn;
};

export default function DraggableLayer({ paneIds, render }: Props) {
  const [layout, setLayout] = useState<LayoutMap>(() =>
    mergeLayout(DEFAULT_PANE_POSITIONS, loadCachedLayout()?.panes)
  );
  const debounceRef = useRef<number | null>(null);
  const snapshotRef = useRef<LayoutSnapshot>({
    version: 1,
    panes: layout,
    nodes: {},
    obsidianNodes: {},
    updatedAt: null
  });

  // Hydrate from server on mount
  useEffect(() => {
    void (async () => {
      const server = await fetchServerLayout();
      if (server) {
        const merged = mergeLayout(DEFAULT_PANE_POSITIONS, server.panes);
        setLayout(merged);
        snapshotRef.current = { ...server, panes: merged };
        cacheLayout(snapshotRef.current);
      }
    })();
  }, []);

  const persistDebounced = useCallback((next: LayoutMap) => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      const snapshot = { ...snapshotRef.current, panes: next };
      snapshotRef.current = snapshot;
      cacheLayout(snapshot);
      void persistServerLayout({ panes: next });
    }, 400);
  }, []);

  const onPositionChange = useCallback(
    (id: string, position: PanePosition) => {
      setLayout((prev) => {
        const next = { ...prev, [id]: { ...prev[id], ...position } };
        persistDebounced(next);
        return next;
      });
    },
    [persistDebounced]
  );

  const [focused, setFocused] = useState<string | null>(null);
  const onFocus = useCallback((id: string) => {
    setFocused(id);
  }, []);

  return (
    <div className="draggable-layer">
      {paneIds.map((id) => {
        const pos = layout[id] || DEFAULT_PANE_POSITIONS[id] || { x: 0, y: 0 };
        const z = focused === id ? 50 : 10;
        return (
          <span key={id}>
            {render(id, { ...pos, z }, onPositionChange, onFocus)}
          </span>
        );
      })}
    </div>
  );
}
