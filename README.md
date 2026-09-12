# RealtimeCanvas

**Draw together. In real time.**

A real-time collaborative drawing canvas built as a Frontend R&D assignment. Open the app in two browser windows, join the same room, and watch strokes appear live in both.

## Overview

RealtimeCanvas is a shared whiteboard where multiple participants draw on the same canvas simultaneously. The interesting engineering problems are:

- **Synchronizing freehand input** (hundreds of pointer events per second) across clients without flooding the network or React.
- **Making late joiners and reconnecting clients converge** on the same canvas state.
- **Keeping rendering off React's critical path** so drawing stays smooth at 60fps.

The event-sourcing design solves all three at once: the network carries *drawing operations*, never canvas images. The same op log that syncs clients in real time is also the room history that late joiners replay.

## Features

- Room-based collaboration: create a room (6-char code) or join with a code
- Real-time stroke, shape, clear, and cursor synchronization via Socket.IO
- Tools: pen, highlighter (semi-transparent), eraser, line, rectangle, circle/ellipse, arrow (stroke/fill toggle for shapes)
- Color palette + custom color picker; six brush sizes
- Undo/redo of your own ops; collaborative clear with confirmation
- PNG export (composited on white)
- Presence: live participant count, connection status (🟢🟡🔴), join/leave toasts
- Remote cursors with per-user color and name, throttled to ≤25 updates/sec
- Zoom in/out/reset with transform-aware pointer math
- Keyboard shortcuts (P, E, H, L, R, C, A + Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z)
- Responsive layout down to mobile widths; pointer events unify mouse/touch/pen

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, HTML5 Canvas, Socket.IO client |
| Backend | Node.js, TypeScript, Express, Socket.IO |
| Shared | `@realtimecanvas/shared` — event types + runtime validators used by both sides |

## Architecture

```text
┌──────────────┐         ┌─────────────────────────┐         ┌──────────────┐
│   Client A   │         │  Node.js + Socket.IO    │         │   Client B   │
│ React + ts   │◄───────►│  ┌───────────────────┐  │◄───────►│ React + ts   │
│ CanvasEngine │ Socket  │  │   RoomManager     │  │  Socket │ CanvasEngine │
│  (2 canvas)  │ .IO     │  │ users + op history│  │   .IO   │  (2 canvas)  │
└──────────────┘         │  └───────────────────┘  │         └──────────────┘
                         │  Room A │ Room B │ ...  │
                         └─────────────────────────┘
```

Monorepo (npm workspaces):

```text
RealtimeCanvas/
├── client/                  # React + Vite front end
│   └── src/
│       ├── canvas/          # CanvasEngine, renderer, history (no React)
│       ├── components/      # Room (Lobby/Header/StatusBar), Toolbar, UI
│       ├── hooks/           # useSocket, useRoomConnection, useCanvasEngine, shortcuts
│       ├── services/        # socket singleton
│       └── types/           # ambient env types
├── server/                  # Express + Socket.IO backend
│   └── src/
│       ├── rooms/           # RoomManager (in-memory rooms + op history)
│       ├── socket/          # typed socket alias
│       └── server.ts
└── shared/                  # types + validation used by client and server
```

### Two-canvas rendering

Each board is **two stacked `<canvas>` elements**:

1. **Base canvas** — committed operations only (local + remote). A new remote op is painted incrementally; the base is fully re-rendered only on undo/redo/clear/resize.
2. **Overlay canvas** — the in-progress draft (live stroke preview / shape preview) and remote cursors. Cleared and redrawn on `requestAnimationFrame` only while something is actually dirty.

This keeps the 60fps interaction path (clear + redraw overlay) completely off the base canvas, so committed pixels are never re-composited while you draw. Both canvases are `devicePixelRatio`-aware (capped at 2×) so strokes are crisp on HiDPI screens.

## Data Flow

```text
Pointer events (down/move/up)
   ↓  CanvasEngine collects points, skips <1px micro-moves
Drawing operation (normalized 0..1 coords)
   ↓  committed locally to history + painted incrementally on base canvas
socket.emit('draw', op)
   ↓
Server: validateDrawingOp() → RoomManager.appendOp()
   ↓  io.to(room).emit('draw', entry)
Every client in the room (sender skips its own echo)
   ↓
CanvasEngine paints the op incrementally on the base canvas
```

Key points:

- **Normalized coordinates** (0..1) make ops resolution-independent: two windows of different sizes see the same drawing.
- **The server is the sync point, not a renderer.** It validates, timestamps via sequence ids, appends to room history, and broadcasts.
- **Room isolation** comes from Socket.IO rooms: `socket.to(room).emit(...)` for cursors/presence, `io.to(room).emit(...)` for committed ops. Clients in Room A never receive Room B traffic (covered by the integration test).
- **Late joiners** get `history` in the `room:join` ack and replay it locally.
- **Reconnects**: Socket.IO reconnects automatically; the client re-joins its room, and the fresh `room:joined` ack carries a full history replay that re-syncs the canvas (the history version counter makes replay idempotent).

## Event Model

Drawing operations are small structured events (`shared/src/index.ts`), never images:

```ts
// Freehand stroke (pen, highlighter, eraser)
{ kind: 'stroke', tool: 'pen', color: '#3b82f6', width: 4,
  points: [{ x: 0.12, y: 0.3 }, …] }          // coords normalized 0..1

// Two-point shape (line, rectangle, circle, arrow)
{ kind: 'shape', tool: 'rectangle', style: 'stroke'|'fill',
  color: '#ef4444', width: 8, points: [{x,y}, {x,y}] }

// Canvas-wide action
{ kind: 'clear' }
```

Transport events: `room:join` (ack) / `room:joined`, `draw`, `clear`, `cursor`, `room:peer-joined` / `room:peer-left`, `draw:rejected`.

The server **re-validates every op** (`validateDrawingOp`): tool whitelist, `#rrggbb` colors, widths 1–100, normalized coords, point-count caps (≤2000/stroke), opacity bounds — and re-serializes before rebroadcast. Invalid ops trigger `draw:rejected`; `clear` is only accepted on its dedicated event, never smuggled through `draw`.

## Performance Considerations

**Why Canvas and not DOM/SVG:** a busy whiteboard produces thousands of elements per minute; a flat pixel canvas keeps memory and compositing cost constant regardless of how much has been drawn.

**Why drawing never touches React state:**
- Pointer moves are handled imperatively inside `CanvasEngine`. React state updates happen only when a *stroke completes* (a socket emit), when undo state flips (button enable/disable), or when settings change.
- The in-progress stroke lives in engine fields and renders on the overlay canvas via `requestAnimationFrame` gated by dirty flags — no React re-render per pointer event.

**Event throttling / batching:**
- Cursor broadcasts: throttled to one message per 40ms (≤25/sec) regardless of input rate.
- Stroke points: micro-moves below ~1px are dropped; strokes are capped at 2000 points; one `draw` event per completed stroke, not per pointer event.
- Socket message frequency is therefore proportional to strokes drawn, not input events.

**Rendering strategy:**
- Two-canvas split (above) so the hot path never re-renders committed content.
- Incremental painting of remote ops (no full replay per op).
- Full re-render only on undo/redo/clear/resize/history-replay.
- A permanent `requestAnimationFrame` loop costs one dirty-flag check per frame when idle.

**Memory:**
- History is logical ops, not snapshots; server caps rooms at 5000 ops and drops empty rooms after 30 minutes.
- Local undo stacks only your own ops (bounded by your session's drawing).

## Engineering Trade-offs

Deliberately simple choices, and why:

- **No persistence layer** — rooms live in memory; the last person leaving starts a 30-minute countdown before the room is dropped. Persistence would add a database without changing any frontend engineering.
- **Client-local undo** — you undo only your own ops. A globally-consistent distributed undo requires an operational-transform model that would dominate the codebase; the assignment calls for "undo/redo where technically appropriate."
- **Last-writer-wins concurrent ops** — simultaneous strokes are interleaved by arrival order (server receive order). True CRDT convergence is listed as future work; in practice, overlapping paint ops are commutative, so this is benign for a whiteboard.
- **Clear is a hard reset** — it wipes room history rather than being an undoable op. This matches user expectations on a shared board and keeps the op log small.
- **Zoom scales strokes** — brush width zooms with the view (typical whiteboard behavior). Pan exists in the transform model but is not exposed as a tool yet.
- **Guest identity only** — names/colors are assigned per socket connection; a reconnect gets a new identity. No auth by design.

## Local Setup

Requires Node 18+.

```bash
npm install        # installs all workspaces and builds the shared package
npm run dev        # runs server (:4000) + Vite dev server (:5173) together
```

Open http://localhost:5173. The dev server proxies `/socket.io` and `/api` to :4000.

Production build + run (single origin — Express serves the built client):

```bash
npm run build      # shared → server → client (vite build)
npm start          # Express serves API + client on PORT (default 4000)
```

Integration smoke test (against a running server):

```bash
npm run test:smoke                        # or: node scripts/smoke-test.mjs http://localhost:4000
```

Covers: join/ack, history replay, live draw sync, room isolation, late joiner state, malformed-op rejection, clear sync, cursor sync + bounds, disconnect presence, reconnect history, invalid room ids.

Real-input end-to-end test (`playwright-core`, needs a running server + a Chromium binary — see `scripts/real-input.test.mjs`):

```bash
npm run test:e2e
```

Drives **trusted OS-level mouse input** (not synthetic `dispatchEvent`) through Chromium's real input pipeline and verifies stroke placement against actual canvas pixels: all 7 tools at top-left/center/bottom-right, geometry/backing-store checks, zoom 50%–400% + reset, the dev bundle on :5173, a 390px viewport with scroll offsets, and two-client sync (both directions + simultaneous drawing). This harness is what caught the original pointer-events bug — synthetic events bypass hit-testing, real input does not.

## Environment Variables

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `PORT` | server | `4000` | HTTP + WebSocket port |
| `ALLOWED_ORIGINS` | server | `http://localhost:5173` | Comma-separated CORS origins for cross-origin Socket.IO (dev split-origin mode) |
| `VITE_SERVER_URL` | client (build time) | unset | Absolute server URL for cross-origin deployments. Unset = same-origin (Vite proxy in dev, Express in prod) — no hardcoded `localhost` in production behavior |
| `DEV_SERVER_URL` | vite.config | `http://localhost:4000` | Dev/preview proxy target |

Copy `.env.example` to `.env` for local overrides. `.env` is git-ignored; no secrets are required or stored.

## Deployment

The production topology is **single origin**: Express serves both the built client and the Socket.IO server, so no CORS and no client URL configuration are needed.

1. `npm run build`
2. Run `npm start` on any Node host (Render, Railway, Fly.io, a VPS behind nginx, etc.)
3. Set `PORT` if the host requires a specific port.
4. WebSocket notes: Socket.IO falls back to HTTP long-polling automatically. If your proxy only allows WebSockets after an upgrade (e.g. nginx), either forward `Upgrade`/`Connection` headers or leave the default polling handshake in place — both work.

For a split deployment (static frontend + separate server), set `VITE_SERVER_URL` to the server's public URL at client build time and add that origin to the server's `ALLOWED_ORIGINS`.

> Status: builds and runs locally; **not yet deployed** to a public host.

## Testing Collaboration

1. Run `npm run dev` (or the production `npm start`).
2. Open the app in **two browser windows** (or two machines on the same network).
3. In window A: **Create Room** — note the code in the header.
4. In window B: **Join** with that code.
5. Draw in either window; strokes, shapes, and cursors appear live in both.
6. Try: erase, undo (only removes *your* ops), clear (erases for everyone, with confirmation), export PNG, resize the window, disconnect one window (Wi-Fi off) and watch it resync on reconnect.

Room isolation: create a second room in a third window — its traffic never reaches the first room (verified by `scripts/smoke-test.mjs`).

