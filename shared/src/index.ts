/**
 * Shared types + runtime validation used by both the Socket.IO server and the React client.
 *
 * Drawing operations are transported as structured events (never canvas images) so the
 * event stream doubles as room history, which lets late joiners reconstruct the canvas.
 */

/**
 * Tool ids. `select` is a client-side placeholder (no drawing op is produced with it).
 */
export type ToolId =
  | 'select'
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'line'
  | 'rectangle'
  | 'circle'
  | 'arrow';

export interface Point {
  x: number;
  y: number;
  /** Pressure 0..1; only sent when the device reports real pressure. */
  p?: number;
}

export interface StrokePayload {
  kind: 'stroke';
  tool: 'pen' | 'highlighter' | 'eraser';
  color: string;
  width: number;
  /** Normalized 0..1 coordinates — resolution/zoom independent. */
  points: Point[];
  /** Optional opacity for the highlighter. */
  opacity?: number;
}

export interface ShapePayload {
  kind: 'shape';
  tool: 'line' | 'rectangle' | 'circle' | 'arrow';
  style: 'stroke' | 'fill';
  color: string;
  width: number;
  points: Point[];
  opacity?: number;
}

export interface ClearPayload {
  kind: 'clear';
}

export type DrawingOp = StrokePayload | ShapePayload | ClearPayload;

export interface User {
  id: string;
  name: string;
  color: string;
}

export interface JoinResult {
  ok: true;
  room: string;
  self: User;
  peers: User[];
  history: DrawingOp[];
}

export interface InvalidRoomError {
  ok: false;
  error: 'invalid-room-id';
}

export interface RoomState {
  room: string;
  users: User[];
}

export interface DrawEntry {
  id: string;
  clientId: string;
  op: DrawingOp;
}

export interface CursorEntry {
  id: string;
  clientId: string;
  x: number;
  y: number;
}

export type ClientToServerEvents = {
  'room:join': (roomId: string, ack: (res: JoinResult | InvalidRoomError) => void) => void;
  'room:leave': (roomId: string) => void;
  draw: (op: DrawingOp) => void;
  clear: () => void;
  cursor: (x: number, y: number) => void;
};

export type ServerToClientEvents = {
  'room:joined': (res: JoinResult) => void;
  'room:join-failed': (res: InvalidRoomError) => void;
  'room:peer-joined': (user: User) => void;
  'room:peer-left': (user: User) => void;
  'room:users': (state: RoomState) => void;
  draw: (entry: DrawEntry) => void;
  clear: (entry: { clientId: string }) => void;
  cursor: (entry: CursorEntry) => void;
  'draw:rejected': (payload: { reason: string }) => void;
};

/** Strict server → client / client → server contract is declared above. */
export const TOOLS: readonly ToolId[] = [
  'pen',
  'highlighter',
  'eraser',
  'line',
  'rectangle',
  'circle',
  'arrow',
];

export const STROKE_TOOLS: readonly ToolId[] = ['pen', 'highlighter', 'eraser'];
export const SHAPE_TOOLS: readonly ToolId[] = ['line', 'rectangle', 'circle', 'arrow'];

/** Remote cursor updates are throttled to at most this rate (25/sec). */
export const REMOTE_CURSOR_THROTTLE_MS = 40;

export const PALETTE = [
  '#000000',
  '#ef4444',
  '#3b82f6',
  '#22c55e',
  '#eab308',
  '#a855f7',
  '#ffffff',
] as const;

export const SIZES = [2, 4, 8, 12, 20, 32] as const;
export type SizeOption = (typeof SIZES)[number];

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Max number of points per stroke; the server rejects strokes beyond this. */
export const MAX_POINTS_PER_STROKE = 2000;
/** Cap room history so server memory cannot grow unbounded. */
export const MAX_HISTORY_OPS = 5000;

export const ROOM_ID_RE = /^[A-Z0-9]{6}$/;

export const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

export function isValidRoomId(roomId: unknown): roomId is string {
  return typeof roomId === 'string' && ROOM_ID_RE.test(roomId);
}

export function isValidColor(c: unknown): c is string {
  return typeof c === 'string' && HEX_COLOR_RE.test(c);
}

export interface ValidatedPoint {
  x: number;
  y: number;
  p?: number;
}

function validatePoints(raw: unknown, min: number, max: number): ValidatedPoint[] | string {
  if (!Array.isArray(raw) || raw.length < min || raw.length > max) {
    return `expected between ${min} and ${max} points`;
  }
  const out: ValidatedPoint[] = [];
  for (const pt of raw) {
    if (pt === null || typeof pt !== 'object') return 'point must be an object';
    const p = pt as Record<string, unknown>;
    if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return 'point coords must be finite numbers';
    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return 'coords must be normalized 0..1';
    if (p.p !== undefined) {
      if (!isFiniteNumber(p.p) || p.p < 0 || p.p > 1) return 'pressure must be 0..1';
      out.push({ x: p.x, y: p.y, p: p.p });
    } else {
      out.push({ x: p.x, y: p.y });
    }
  }
  return out;
}

function validateWidth(w: unknown): number | string {
  if (!isFiniteNumber(w) || w < 1 || w > 100) return 'width must be 1..100';
  return w;
}

function validateOpacity(o: unknown): number | undefined | string {
  if (o === undefined) return undefined;
  if (!isFiniteNumber(o) || o <= 0 || o > 1) return 'opacity must be (0..1]';
  return o;
}

/**
 * Validate an untrusted drawing op coming over the socket. Returns a normalized,
 * re-serialized op (never the raw client object) or an error reason.
 */
export function validateDrawingOp(
  op: unknown
): { ok: true; op: DrawingOp } | { ok: false; reason: string } {
  if (op === null || typeof op !== 'object') return { ok: false, reason: 'op must be an object' };
  const o = op as Record<string, unknown>;

  if (o.kind === 'clear') return { ok: true, op: { kind: 'clear' } };

  if (o.kind === 'stroke') {
    if (o.tool !== 'pen' && o.tool !== 'highlighter' && o.tool !== 'eraser') {
      return { ok: false, reason: 'invalid stroke tool' };
    }
    if (!isValidColor(o.color)) return { ok: false, reason: 'invalid color' };
    const width = validateWidth(o.width);
    if (typeof width === 'string') return { ok: false, reason: width };
    const points = validatePoints(o.points, 1, MAX_POINTS_PER_STROKE);
    if (typeof points === 'string') return { ok: false, reason: points };
    const opacity = validateOpacity(o.opacity);
    if (typeof opacity === 'string') return { ok: false, reason: opacity };
    return {
      ok: true,
      op: {
        kind: 'stroke',
        tool: o.tool,
        color: o.color,
        width,
        points,
        ...(opacity !== undefined ? { opacity } : {}),
      },
    };
  }

  if (o.kind === 'shape') {
    if (o.tool !== 'line' && o.tool !== 'rectangle' && o.tool !== 'circle' && o.tool !== 'arrow') {
      return { ok: false, reason: 'invalid shape tool' };
    }
    if (!isValidColor(o.color)) return { ok: false, reason: 'invalid color' };
    const width = validateWidth(o.width);
    if (typeof width === 'string') return { ok: false, reason: width };
    const points = validatePoints(o.points, 2, 32);
    if (typeof points === 'string') return { ok: false, reason: points };
    const style = o.style === 'fill' ? 'fill' : 'stroke';
    const opacity = validateOpacity(o.opacity);
    if (typeof opacity === 'string') return { ok: false, reason: opacity };
    return {
      ok: true,
      op: {
        kind: 'shape',
        tool: o.tool,
        style,
        color: o.color,
        width,
        points: points.map(({ x, y }) => ({ x, y })),
        ...(opacity !== undefined ? { opacity } : {}),
      },
    };
  }

  return { ok: false, reason: 'unknown op kind' };
}
