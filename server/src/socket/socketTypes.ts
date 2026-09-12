import type { Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@realtimecanvas/shared';
import type { InterServerEvents, SocketData } from '../types.js';

/** A connected socket with our typed event contract and per-socket data. */
export type SocketWithEvents = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
