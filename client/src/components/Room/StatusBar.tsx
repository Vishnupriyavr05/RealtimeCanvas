import type { ConnectionState } from '../../services/socket';

export interface StatusBarProps {
  roomId: string;
  connectionState: ConnectionState;
  peerCount: number;
}

export function StatusBar({ roomId, connectionState, peerCount }: StatusBarProps) {
  return (
    <footer className="statusbar">
      <span>Room {roomId}</span>
      <span aria-hidden>·</span>
      <span>
        {connectionState === 'connected'
          ? 'Live — changes sync instantly'
          : connectionState === 'connecting'
            ? 'Reconnecting…'
            : 'Offline — your strokes will not reach others until reconnected'}
      </span>
      <span aria-hidden>·</span>
      <span>
        {peerCount} {peerCount === 1 ? 'participant' : 'participants'}
      </span>
    </footer>
  );
}
