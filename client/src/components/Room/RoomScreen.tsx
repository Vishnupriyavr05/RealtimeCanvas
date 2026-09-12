import { useCallback, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { DrawingOp, ToolId } from '@realtimecanvas/shared';
import { useSocket } from '../../hooks/useSocket';
import type { RoomConnection } from '../../hooks/useRoomConnection';
import { useCanvasEngine } from '../../hooks/useCanvasEngine';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { Header } from './Header';
import { Toolbar } from '../Toolbar/Toolbar';
import { StatusBar } from './StatusBar';
import { ConfirmDialog } from '../UI/ConfirmDialog';

export interface RoomScreenProps {
  roomId: string;
  room: RoomConnection;
  onLeave: () => void;
}

export function RoomScreen({ roomId, room, onLeave }: RoomScreenProps) {
  const { socket, state } = useSocket();
  const [tool, setTool] = useState<ToolId>('pen');
  const [color, setColor] = useState<string>('#000000');
  const [width, setWidth] = useState<number>(4);
  const [style, setStyle] = useState<'stroke' | 'fill'>('stroke');
  const [confirmClear, setConfirmClear] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  const handleLocalOp = useCallback(
    (op: DrawingOp) => {
      socket.emit('draw', op);
    },
    [socket]
  );

  const { engineRef, historyTick, onUndo, onRedo } = useCanvasEngine({
    containerRef,
    socket,
    historyVersion: room.historyVersion,
    history: room.history,
    tool,
    color,
    width,
    style,
    peers: room.peers,
    onLocalOp: handleLocalOp,
  });

  useKeyboardShortcuts(
    useMemo(
      () => ({
        onTool: setTool,
        onUndo,
        onRedo,
      }),
      [onUndo, onRedo]
    )
  );

  const doClear = () => {
    engineRef.current?.clearAll();
    socket.emit('clear');
    setConfirmClear(false);
  };

  const doExport = () => {
    const engine = engineRef.current;
    if (!engine) return;
    const dataUrl = engine.exportPng();
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `realtimecanvas-${roomId}.png`;
    a.click();
  };

  void historyTick; // room screen re-renders when local undo state changes

  return (
    <div className="room-screen">
      <Header roomId={roomId} connectionState={state} peers={room.peers} self={room.self} onLeave={onLeave} />

      <Toolbar
        tool={tool}
        setTool={setTool}
        color={color}
        setColor={setColor}
        width={width}
        setWidth={setWidth}
        style={style}
        setStyle={setStyle}
        onUndo={onUndo}
        onRedo={onRedo}
        canUndo={engineRef.current?.canUndo() ?? false}
        canRedo={engineRef.current?.canRedo() ?? false}
        onClear={() => setConfirmClear(true)}
        onExport={doExport}
        onZoomIn={() => engineRef.current?.zoomIn()}
        onZoomOut={() => engineRef.current?.zoomOut()}
        onResetZoom={() => engineRef.current?.resetView()}
      />

      <main className="board-area">
        <div ref={containerRef} className="board-surface" />
        {room.notifications.map((n) => (
          <div key={n.id} className="toast">
            {n.text}
          </div>
        ))}
        {state === 'disconnected' && (
          <div className="offline-banner">
            <AlertTriangle size={14} /> Connection lost — reconnecting…
          </div>
        )}
      </main>

      <StatusBar
        roomId={roomId}
        connectionState={state}
        peerCount={room.peers.length + (room.self ? 1 : 0)}
      />

      {confirmClear && (
        <ConfirmDialog
          title="Clear the canvas?"
          body="This erases the drawing for everyone in the room."
          confirmLabel="Clear for everyone"
          onConfirm={doClear}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </div>
  );
}
