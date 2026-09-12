import { useState } from 'react';
import { ROOM_ID_RE } from '@realtimecanvas/shared';
import type { JoinOutcome } from '../../hooks/useRoomConnection';
import type { ConnectionState } from '../../services/socket';

interface LobbyProps {
  onJoin: (roomId: string) => Promise<JoinOutcome>;
  connectionState: ConnectionState;
}

function randomRoomId(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export function Lobby({ onJoin, connectionState }: LobbyProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const submit = async (roomId: string) => {
    const normalized = roomId.trim().toUpperCase();
    if (!ROOM_ID_RE.test(normalized)) {
      setError('Room IDs are 6 characters, letters and digits.');
      return;
    }
    setJoining(true);
    const res = await onJoin(normalized);
    setJoining(false);
    if (!res.ok) {
      setError(
        res.error === 'timeout'
          ? 'Could not reach the server. Is it running?'
          : 'Invalid room ID format.'
      );
    }
  };

  return (
    <div className="lobby">
      <div className="lobby-card">
        <div className="lobby-brand">
          <span className="brand-dot" aria-hidden />
          <h1 className="brand-name">RealtimeCanvas</h1>
        </div>
        <p className="tagline">Draw together. In real time.</p>
        <p className="lobby-sub">
          One shared canvas, zero setup. Create a room and share the 6-character
          code with everyone you want to draw with.
        </p>

        <button className="btn btn-primary btn-large" onClick={() => submit(randomRoomId())} disabled={joining}>
          Create Room
        </button>

        <div className="lobby-divider">
          <span>or join with a code</span>
        </div>

        <form
          className="join-row"
          onSubmit={(e) => {
            e.preventDefault();
            submit(value);
          }}
        >
          <input
            className="room-input"
            value={value}
            onChange={(e) => {
              setValue(e.target.value.toUpperCase());
              setError(null);
            }}
            placeholder="A7K29P"
            maxLength={6}
            autoCapitalize="characters"
            spellCheck={false}
            aria-label="Room ID"
          />
          <button type="submit" className="btn btn-secondary" disabled={joining}>
            Join
          </button>
        </form>

        {error && <p className="form-error">{error}</p>}

        <div className="lobby-status">
          <span
            className={
              connectionState === 'connected'
                ? 'conn-dot conn-green'
                : connectionState === 'connecting'
                  ? 'conn-dot conn-yellow'
                  : 'conn-dot conn-red'
            }
            aria-hidden
          />
          {connectionState === 'connected'
            ? 'Connected to the collaboration server'
            : connectionState === 'connecting'
              ? 'Connecting to the collaboration server…'
              : 'Disconnected from the server — retrying…'}
        </div>

        <ul className="lobby-help">
          <li>1 — Create a room, or type a code a friend sent you.</li>
          <li>2 — Share the code. Anyone with it can draw.</li>
          <li>3 — Watch strokes appear live in every window.</li>
        </ul>
      </div>
    </div>
  );
}
