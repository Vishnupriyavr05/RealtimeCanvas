import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@realtimecanvas/shared';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: TypedSocket | null = null;

export function getSocket(): TypedSocket {
  if (socket) return socket;

  const url =
    import.meta.env.VITE_SERVER_URL && import.meta.env.VITE_SERVER_URL !== 'auto'
      ? (import.meta.env.VITE_SERVER_URL as string)
      : undefined; // undefined = same-origin (Vite proxy in dev, Express in prod)

  socket = io(url, {
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
    timeout: 10_000,
  });

  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

export function reconnectSocket(): void {
  if (socket && !socket.connected) socket.connect();
}
