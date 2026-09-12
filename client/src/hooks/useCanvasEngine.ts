import { useEffect, useRef, useState } from 'react';
import type { DrawingOp, ToolId, User } from '@realtimecanvas/shared';
import { CanvasEngine } from '../canvas/canvasEngine';
import type { TypedSocket } from '../services/socket';

export interface UseCanvasEngineParams {
  containerRef: React.RefObject<HTMLDivElement | null>;
  socket: TypedSocket;
  /** Incremented whenever the server delivers a fresh history replay. */
  historyVersion: number;
  history: DrawingOp[];
  tool: ToolId;
  color: string;
  width: number;
  style: 'stroke' | 'fill';
  peers: User[];
  onLocalOp: (op: DrawingOp) => void;
}

export interface UseCanvasEngineResult {
  engineRef: React.MutableRefObject<CanvasEngine | null>;
  /** Bumps whenever local undo state changes so buttons can re-render. */
  historyTick: number;
  onUndo: () => void;
  onRedo: () => void;
}

export function useCanvasEngine(params: UseCanvasEngineParams): UseCanvasEngineResult {
  const { containerRef, socket, historyVersion, history, tool, color, width, style, peers, onLocalOp } =
    params;

  const engineRef = useRef<CanvasEngine | null>(null);
  const [historyTick, setHistoryTick] = useState(0);

  const peersRef = useRef(new Map<string, User>());
  useEffect(() => {
    const map = new Map<string, User>();
    for (const p of peers) map.set(p.id, p);
    peersRef.current = map;
  }, [peers]);

  // Create/destroy the engine with the room screen. The engine owns the
  // canvases; React never re-renders them.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let engine: CanvasEngine | null = null;
    try {
      engine = new CanvasEngine({
        container,
        onLocalOp,
        onCursorMove: (x, y) => socket.emit('cursor', x, y),
        onHistoryChange: () => setHistoryTick((t) => t + 1),
      });
    } catch (err) {
      console.error('[canvas] initialization failed', err);
      return;
    }
    engineRef.current = engine;
    // Dev/test hook: lets the real-input harness and devtools inspect the
    // engine (zoom/pan state). Application code never reads it.
    (window as unknown as { __engine?: CanvasEngine }).__engine = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
      delete (window as unknown as { __engine?: CanvasEngine }).__engine;
    };
    // Engine is created once per room mount; callbacks are stable refs below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, socket]);

  // Push settings down via setters (no engine rebuild, no canvas re-render).
  useEffect(() => {
    engineRef.current?.setTool(tool);
  }, [tool]);
  useEffect(() => {
    engineRef.current?.setColor(color);
  }, [color]);
  useEffect(() => {
    engineRef.current?.setWidth(width);
  }, [width]);
  useEffect(() => {
    engineRef.current?.setStyle(style);
  }, [style]);

  // Replay history when the server re-syncs (initial join + reconnects).
  // Guarded per engine instance: a StrictMode remount creates a fresh engine
  // that must receive the current history even if the version is unchanged.
  const appliedRef = useRef<{ engine: CanvasEngine | null; version: number }>({
    engine: null,
    version: -1,
  });
  const historyRef = useRef(history);
  historyRef.current = history;
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (appliedRef.current.engine === engine && appliedRef.current.version === historyVersion) return;
    appliedRef.current = { engine, version: historyVersion };
    engine.setHistory(historyRef.current);
  }, [historyVersion, engineRef]);

  // Wire remote socket events into the engine.
  useEffect(() => {
    const onDraw = (entry: { clientId: string; op: DrawingOp }) => {
      // The server broadcasts to the whole room, including the sender. We
      // already committed our own ops locally — processing the echo again
      // would double-draw and break local undo (the op would stay visible).
      if (entry.clientId === socket.id) return;
      engineRef.current?.handleRemoteOp(entry.op);
    };
    const onClear = () => {
      engineRef.current?.handleRemoteOp({ kind: 'clear' });
    };
    const onCursor = (entry: { clientId: string; x: number; y: number }) => {
      const peer = peersRef.current.get(entry.clientId);
      engineRef.current?.updateRemoteCursor(
        entry.clientId,
        entry.x,
        entry.y,
        peer?.color ?? '#94a3b8',
        peer?.name ?? ''
      );
    };
    const onPeerLeft = (user: User) => {
      engineRef.current?.removeRemoteCursor(user.id);
    };

    socket.on('draw', onDraw);
    socket.on('clear', onClear);
    socket.on('cursor', onCursor);
    socket.on('room:peer-left', onPeerLeft);

    return () => {
      socket.off('draw', onDraw);
      socket.off('clear', onClear);
      socket.off('cursor', onCursor);
      socket.off('room:peer-left', onPeerLeft);
    };
  }, [socket]);

  const onUndo = () => engineRef.current?.undo();
  const onRedo = () => engineRef.current?.redo();

  return { engineRef, historyTick, onUndo, onRedo };
}
