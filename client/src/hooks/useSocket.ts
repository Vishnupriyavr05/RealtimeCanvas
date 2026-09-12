import { useEffect, useState } from 'react';
import {
  getSocket,
  type ConnectionState,
  type TypedSocket,
} from '../services/socket';

/**
 * Returns the shared socket instance and a live connection state.
 * The socket object itself is a stable singleton; only state changes re-render.
 */
export function useSocket(): { socket: TypedSocket; state: ConnectionState } {
  const socket = getSocket();
  const [state, setState] = useState<ConnectionState>(() =>
    socket.connected ? 'connected' : 'connecting'
  );

  useEffect(() => {
    const onConnect = () => setState('connected');
    const onDisconnect = () => setState('disconnected');
    const onReconnectAttempt = () => setState('connecting');

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.io.on('reconnect_attempt', onReconnectAttempt);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.io.off('reconnect_attempt', onReconnectAttempt);
    };
  }, [socket]);

  return { socket, state };
}
