import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DrawingOp,
  JoinResult,
  InvalidRoomError,
  User,
} from '@realtimecanvas/shared';
import { useSocket } from './useSocket';

export interface JoinOutcome {
  ok: boolean;
  error?: string;
}

export interface RoomNotification {
  id: number;
  text: string;
}

export interface RoomConnection {
  self: User | null;
  peers: User[];
  history: DrawingOp[];
  historyVersion: number;
  notifications: RoomNotification[];
  join: (roomId: string) => Promise<JoinOutcome>;
  leave: () => void;
}

const JOIN_TIMEOUT_MS = 6000;

/**
 * Room lifecycle built on the singleton socket.
 *
 * `room:joined` (server → joining client) is handled by ONE persistent listener.
 * It fires on the initial join and again after any reconnect, because the server
 * treats a reconnecting socket as a new socket and re-sends the full history.
 * That single path gives us reconnection resync for free and avoids
 * duplicate-stroke bugs from double replays.
 */
export function useRoomConnection(): RoomConnection {
  const { socket } = useSocket();
  const [self, setSelf] = useState<User | null>(null);
  const [peers, setPeers] = useState<User[]>([]);
  const [history, setHistory] = useState<DrawingOp[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [notifications, setNotifications] = useState<RoomNotification[]>([]);

  const notifId = useRef(0);
  const pendingJoin = useRef<((res: JoinOutcome) => void) | null>(null);
  const currentRoom = useRef<string | null>(null);
  const selfRef = useRef<User | null>(null);

  const pushNotification = useCallback((text: string) => {
    const id = ++notifId.current;
    setNotifications((prev) => [...prev.slice(-2), { id, text }]);
    window.setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 4500);
  }, []);

  const join = useCallback(
    (roomId: string) =>
      new Promise<JoinOutcome>((resolve) => {
        const normalized = roomId.trim().toUpperCase();
        const timeout = window.setTimeout(() => {
          if (pendingJoin.current) {
            pendingJoin.current = null;
            resolve({ ok: false, error: 'timeout' });
          }
        }, JOIN_TIMEOUT_MS);
        pendingJoin.current = (res) => {
          window.clearTimeout(timeout);
          pendingJoin.current = null;
          resolve(res);
        };
        socket.emit('room:join', normalized, () => {});
      }),
    [socket]
  );

  useEffect(() => {
    const onJoined = (res: JoinResult) => {
      setSelf(res.self);
      selfRef.current = res.self;
      setPeers(res.peers);
      setHistory(res.history);
      setHistoryVersion((v) => v + 1);
      currentRoom.current = res.room;
      pendingJoin.current?.({ ok: true });
    };

    const onJoinFailed = (_res: InvalidRoomError) => {
      pendingJoin.current?.({ ok: false, error: 'invalid-room-id' });
    };

    const onPeerJoined = (user: User) => {
      setPeers((prev) => (prev.some((p) => p.id === user.id) ? prev : [...prev, user]));
      pushNotification(`${user.name} joined`);
    };

    const onPeerLeft = (user: User) => {
      setPeers((prev) => prev.filter((p) => p.id !== user.id));
      pushNotification(`${user.name} left`);
    };

    socket.on('room:joined', onJoined);
    socket.on('room:join-failed', onJoinFailed);
    socket.on('room:peer-joined', onPeerJoined);
    socket.on('room:peer-left', onPeerLeft);

    return () => {
      socket.off('room:joined', onJoined);
      socket.off('room:join-failed', onJoinFailed);
      socket.off('room:peer-joined', onPeerJoined);
      socket.off('room:peer-left', onPeerLeft);
    };
  }, [socket, pushNotification]);

  // On reconnect, the socket id changes and the server has dropped us from all
  // rooms. Listen for the actual 'connect' event (not just mount-time state):
  // re-join the current room and the fresh history replay resyncs the canvas.
  useEffect(() => {
    const onConnect = () => {
      const room = currentRoom.current;
      if (room) {
        socket.emit('room:join', room, () => {});
        pushNotification('Reconnected — resyncing canvas');
      }
    };
    socket.on('connect', onConnect);
    return () => {
      socket.off('connect', onConnect);
    };
  }, [socket, pushNotification]);

  const leave = useCallback(() => {
    const room = currentRoom.current;
    if (room) {
      socket.emit('room:leave', room);
      currentRoom.current = null;
      selfRef.current = null;
      setSelf(null);
      setPeers([]);
      setHistory([]);
      setHistoryVersion((v) => v + 1);
    }
  }, [socket]);

  return { self, peers, history, historyVersion, notifications, join, leave };
}
