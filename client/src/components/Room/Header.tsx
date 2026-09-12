import { useState } from 'react';
import { Copy, Check, LogOut } from 'lucide-react';
import type { User } from '@realtimecanvas/shared';
import type { ConnectionState } from '../../services/socket';

export interface HeaderProps {
  roomId: string;
  connectionState: ConnectionState;
  peers: User[];
  self: User | null;
  onLeave: () => void;
}

const CONNECTION_META: Record<ConnectionState, { dot: string; label: string }> = {
  connected: { dot: 'conn-dot conn-green', label: 'Connected' },
  connecting: { dot: 'conn-dot conn-yellow', label: 'Connecting…' },
  disconnected: { dot: 'conn-dot conn-red', label: 'Disconnected' },
};

export function Header({ roomId, connectionState, peers, self, onLeave }: HeaderProps) {
  const [copied, setCopied] = useState(false);
  const meta = CONNECTION_META[connectionState];

  const copyRoom = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — non-fatal */
    }
  };

  const total = peers.length + (self ? 1 : 0);

  return (
    <header className="header">
      <div className="header-left">
        <span className="brand-dot" aria-hidden />
        <span className="brand-name">RealtimeCanvas</span>
        <span className="room-chip">
          Room: <strong>{roomId}</strong>
          <button className="icon-btn small" onClick={copyRoom} title="Copy room ID" aria-label="Copy room ID">
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        </span>
      </div>

      <div className="header-right">
        <span className="conn-pill" title={`Socket status: ${connectionState}`}>
          <span className={meta.dot} aria-hidden />
          {meta.label}
        </span>
        <span className="presence-pill" title="Connected collaborators">
          👥 {total} {total === 1 ? 'collaborator' : 'collaborators'}
        </span>
        <button className="btn btn-ghost" onClick={onLeave} title="Leave room">
          <LogOut size={14} /> Leave
        </button>
      </div>
    </header>
  );
}
