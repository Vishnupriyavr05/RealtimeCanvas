import type { User } from '@realtimecanvas/shared';

export interface SocketData {
  user: User;
  room: string | null;
}

export interface InterServerEvents {}

export type ServerSocket = import('socket.io').Socket<
  import('@realtimecanvas/shared').ClientToServerEvents,
  import('@realtimecanvas/shared').ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
