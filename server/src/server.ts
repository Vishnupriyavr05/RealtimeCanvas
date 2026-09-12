import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import {
  isValidRoomId,
  validateDrawingOp,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type User,
} from '@realtimecanvas/shared';
import { RoomManager } from './rooms/RoomManager.js';
import type { SocketData, InterServerEvents } from './types.js';
import type { SocketWithEvents } from './socket/socketTypes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tolerate empty/invalid PORT env values (e.g. PORT="" → Number("") === 0).
const PORT = (() => {
  const raw = process.env.PORT;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 4000;
})();
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const app = express();

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Production single-origin mode: Express serves the built client.
const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));

const server = http.createServer(app);

const io = new SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(server, {
  cors: { origin: ALLOWED_ORIGINS, methods: ['GET', 'POST'] },
  pingInterval: 25_000,
  pingTimeout: 20_000,
});

const rooms = new RoomManager();
rooms.startSweeper();

const GUEST_COLORS = [
  '#f43f5e',
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#6366f1',
  '#f97316',
  '#84cc16',
];

function assignUser(socketId: string): User {
  let hash = 0;
  for (let i = 0; i < socketId.length; i++) {
    hash = (hash * 31 + socketId.charCodeAt(i)) >>> 0;
  }
  const index = hash % GUEST_COLORS.length;
  const name = `Guest ${String(index + 1).padStart(2, '0')}`;
  return { id: socketId, name, color: GUEST_COLORS[index] ?? '#94a3b8' };
}

io.on('connection', (socket) => {
  socket.data.user = assignUser(socket.id);
  socket.data.room = null;

  socket.on('room:join', (roomId, ack) => {
    if (typeof ack !== 'function') return;
    if (!isValidRoomId(roomId)) {
      ack({ ok: false, error: 'invalid-room-id' });
      socket.emit('room:join-failed', { ok: false, error: 'invalid-room-id' });
      return;
    }
    if (socket.data.room && socket.data.room !== roomId) {
      leaveCurrentRoom(socket);
    }

    socket.data.room = roomId;
    socket.join(roomId);
    const user = socket.data.user;
    const state = rooms.join(roomId, user);
    const peers = state.filter((u) => u.id !== socket.id);

    ack({ ok: true, room: roomId, self: user, peers, history: rooms.getHistory(roomId) });
    socket.emit('room:joined', {
      ok: true,
      room: roomId,
      self: user,
      peers,
      history: rooms.getHistory(roomId),
    });
    socket.to(roomId).emit('room:peer-joined', user);
  });

  socket.on('draw', (op) => {
    const room = socket.data.room;
    if (!room) return;
    const result = validateDrawingOp(op);
    if (!result.ok || result.op.kind === 'clear') {
      // Clears have their own dedicated event; reject them on `draw`.
      socket.emit('draw:rejected', { reason: result.ok ? 'use the clear event' : result.reason });
      return;
    }
    const entry = rooms.appendOp(room, socket.id, result.op);
    if (!entry) return;
    io.to(room).emit('draw', entry);
  });

  socket.on('clear', () => {
    const room = socket.data.room;
    if (!room) return;
    rooms.clearHistory(room, socket.id);
    io.to(room).emit('clear', { clientId: socket.id });
  });

  socket.on('cursor', (x, y) => {
    const room = socket.data.room;
    if (!room) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    socket.to(room).emit('cursor', { id: socket.id, clientId: socket.id, x, y });
  });

  socket.on('room:leave', (roomId) => {
    if (socket.data.room === roomId) {
      leaveCurrentRoom(socket);
    }
  });

  socket.on('disconnect', () => {
    leaveCurrentRoom(socket);
  });
});

function leaveCurrentRoom(socket: SocketWithEvents) {
  const room = socket.data.room;
  if (!room) return;
  socket.data.room = null;
  socket.leave(room);
  const user = socket.data.user;
  if (user && rooms.leave(room, user.id)) {
    io.to(room).emit('room:peer-left', user);
  }
}

server.listen(PORT, () => {
  console.log(`[server] RealtimeCanvas server listening on :${PORT}`);
  console.log(`[server] allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
});
