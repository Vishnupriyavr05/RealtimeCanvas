import {
  MAX_HISTORY_OPS,
  type DrawingOp,
  type User,
} from '@realtimecanvas/shared';
import type { DrawEntry } from '@realtimecanvas/shared';

interface RoomRecord {
  users: Map<string, User>;
  history: DrawingOp[];
  /** Monotonic counter used to derive op ids (id = `${clientId}:${n}`). */
  seq: number;
  lastActivityAt: number;
}

/** Rooms with no members are dropped after this idle period. */
const EMPTY_ROOM_TTL_MS = 30 * 60 * 1000;
/** How often we sweep empty rooms. */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export class RoomManager {
  private rooms = new Map<string, RoomRecord>();
  private sweeper: ReturnType<typeof setInterval> | null = null;

  startSweeper(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweeper.unref?.();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, room] of this.rooms) {
      if (room.users.size === 0 && now - room.lastActivityAt > EMPTY_ROOM_TTL_MS) {
        this.rooms.delete(id);
      }
    }
  }

  private getOrCreate(roomId: string): RoomRecord {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = { users: new Map(), history: [], seq: 0, lastActivityAt: Date.now() };
      this.rooms.set(roomId, room);
    }
    return room;
  }

  join(roomId: string, user: User): User[] {
    const room = this.getOrCreate(roomId);
    room.users.set(user.id, user);
    room.lastActivityAt = Date.now();
    return [...room.users.values()];
  }

  leave(roomId: string, userId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    const removed = room.users.delete(userId);
    room.lastActivityAt = Date.now();
    return removed;
  }

  users(roomId: string): User[] {
    const room = this.rooms.get(roomId);
    return room ? [...room.users.values()] : [];
  }

  getHistory(roomId: string): DrawingOp[] {
    const room = this.rooms.get(roomId);
    return room ? [...room.history] : [];
  }

  appendOp(roomId: string, clientId: string, op: DrawingOp): DrawEntry | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.seq += 1;
    const entry: DrawEntry = { id: `${clientId}:${room.seq}`, clientId, op };
    room.history.push(op);
    if (room.history.length > MAX_HISTORY_OPS) {
      room.history.splice(0, room.history.length - MAX_HISTORY_OPS);
    }
    room.lastActivityAt = Date.now();
    return entry;
  }

  /**
   * A clear wipes the authoritative history so late joiners start from an
   * empty canvas. The clear itself is recorded so a client that drew between
   * its own local render and the broadcast does not resurrect old ops on the
   * next full replay.
   */
  clearHistory(roomId: string, clientId: string): DrawEntry | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.history = [{ kind: 'clear' }];
    room.seq += 1;
    room.lastActivityAt = Date.now();
    return { id: `${clientId}:${room.seq}`, clientId, op: { kind: 'clear' } };
  }

  roomCount(): number {
    return this.rooms.size;
  }
}
