import { useCallback, useRef, useState } from "react";

const MAX_HISTORY = 50;

function cloneSnapshot(nodes, edges) {
  return {
    nodes: JSON.parse(JSON.stringify(nodes)),
    edges: JSON.parse(JSON.stringify(edges)),
  };
}

export default function useWorkflowHistory() {
  const pastRef = useRef([]);
  const futureRef = useRef([]);
  const [tick, setTick] = useState(0);

  const bump = useCallback(() => setTick((t) => t + 1), []);

  const resetHistory = useCallback(() => {
    pastRef.current = [];
    futureRef.current = [];
    bump();
  }, [bump]);

  const pushHistory = useCallback(
    (nodes, edges) => {
      pastRef.current.push(cloneSnapshot(nodes, edges));
      if (pastRef.current.length > MAX_HISTORY) {
        pastRef.current.shift();
      }
      futureRef.current = [];
      bump();
    },
    [bump],
  );

  const undo = useCallback(
    (nodes, edges, applySnapshot) => {
      if (pastRef.current.length === 0) return false;
      futureRef.current.push(cloneSnapshot(nodes, edges));
      const prev = pastRef.current.pop();
      applySnapshot(prev.nodes, prev.edges);
      bump();
      return true;
    },
    [bump],
  );

  const redo = useCallback(
    (nodes, edges, applySnapshot) => {
      if (futureRef.current.length === 0) return false;
      pastRef.current.push(cloneSnapshot(nodes, edges));
      const next = futureRef.current.pop();
      applySnapshot(next.nodes, next.edges);
      bump();
      return true;
    },
    [bump],
  );

  return {
    pushHistory,
    undo,
    redo,
    resetHistory,
    canUndo: tick >= 0 && pastRef.current.length > 0,
    canRedo: tick >= 0 && futureRef.current.length > 0,
  };
}
