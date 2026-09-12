import type {
  DrawingOp,
  Point,
  ShapePayload,
  StrokePayload,
  ToolId,
} from '@realtimecanvas/shared';
import { REMOTE_CURSOR_THROTTLE_MS } from '@realtimecanvas/shared';
import { drawCursor, drawOp, drawStrokeSegment, type ViewTransform } from './render';
import { DrawingHistory } from './history';

export interface RemoteCursor {
  x: number;
  y: number;
  color: string;
  label: string;
  lastSeen: number;
}

export interface EngineOptions {
  container: HTMLDivElement;
  onLocalOp: (op: DrawingOp) => void;
  onCursorMove: (x: number, y: number) => void;
  onHistoryChange: () => void;
}

export class CanvasEngine {
  private canvas: HTMLCanvasElement;
  private overlay: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private overlayCtx: CanvasRenderingContext2D;
  private container: HTMLDivElement;
  private resizeObserver: ResizeObserver;

  private cssW = 0;
  private cssH = 0;

  private tool: ToolId = 'pen';
  private color = '#000000';
  private width = 4;
  private style: 'stroke' | 'fill' = 'stroke';

  private history = new DrawingHistory();
  private transform: ViewTransform = { scale: 1, offsetX: 0, offsetY: 0 };

  private draftPoints: Point[] = [];
  private draftShapeStart: Point | null = null;
  private draftShapeCurrent: Point | null = null;
  private isDrawing = false;

  private remoteCursors = new Map<string, RemoteCursor>();
  private overlayDirty = false;

  private rafId: number | null = null;
  private needsFullRedraw = true;
  private detachFns: (() => void)[] = [];

  private options: EngineOptions;

  constructor(options: EngineOptions) {
    this.options = options;
    this.container = options.container;
    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.touchAction = 'none';
    this.canvas.style.display = 'block';
    this.container.appendChild(this.canvas);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;

    // Overlay canvas holds the in-progress draft and remote cursors so the
    // committed base canvas never needs clearing while drawing.
    this.overlay = document.createElement('canvas');
    this.overlay.style.width = '100%';
    this.overlay.style.height = '100%';
    this.overlay.style.touchAction = 'none';
    this.overlay.style.display = 'block';
    this.overlay.style.position = 'absolute';
    this.overlay.style.inset = '0';
    // The overlay is a pure rendering surface (live draft + remote cursors).
    // It must not intercept pointer events — they are handled on the base
    // canvas so real mouse/touch input reaches the drawing handlers.
    this.overlay.style.pointerEvents = 'none';
    const overlayCtx = this.overlay.getContext('2d');
    if (!overlayCtx) throw new Error('Canvas 2D context unavailable');
    this.overlayCtx = overlayCtx;
    this.container.appendChild(this.overlay);

    this.attachPointerHandlers();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.startLoop();
  }

  /** True when the tool draws a previewable two-point shape. */
  private isShapeTool(t: ToolId): boolean {
    return t === 'line' || t === 'rectangle' || t === 'circle' || t === 'arrow';
  }

  setTool(tool: ToolId): void {
    this.tool = tool;
    this.canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair';
  }

  setColor(color: string): void {
    this.color = color;
  }

  setWidth(width: number): void {
    this.width = width;
  }

  setStyle(style: 'stroke' | 'fill'): void {
    this.style = style;
  }

  // ── Networking glue (called from React effects) ────────────────
  handleRemoteOp(op: DrawingOp): void {
    if (op.kind === 'clear') {
      this.history.clearAll();
      this.renderAll();
      return;
    }
    this.history.addRemote(op);
    this.handleRemoteOpAndDraw(op);
  }

  setHistory(ops: DrawingOp[]): void {
    this.history.clearAll();
    for (const op of ops) this.history.addRemote(op);
    this.renderAll();
  }

  clearAll(): void {
    this.history.clearAll();
    this.renderAll();
  }

  updateRemoteCursor(clientId: string, x: number, y: number, color: string, label: string): void {
    // Content (0..1) coords → screen-space CSS pixels under the current transform.
    this.remoteCursors.set(clientId, {
      x: x * this.cssW * this.transform.scale + this.transform.offsetX,
      y: y * this.cssH * this.transform.scale + this.transform.offsetY,
      color,
      label,
      lastSeen: Date.now(),
    });
    this.overlayDirty = true;
  }

  removeRemoteCursor(clientId: string): void {
    if (this.remoteCursors.delete(clientId)) this.overlayDirty = true;
  }

  // ── Zoom ────────────────────────────────────────────────────────
  zoomIn(): void {
    this.setZoom(this.transform.scale * 1.2);
  }

  zoomOut(): void {
    this.setZoom(this.transform.scale / 1.2);
  }

  resetView(): void {
    this.transform = { scale: 1, offsetX: 0, offsetY: 0 };
    this.renderAll();
  }

  /** Current view transform (read-only copy) — used by tests/devtools. */
  getTransform(): ViewTransform {
    return { ...this.transform };
  }

  private setZoom(next: number): void {
    this.transform = { scale: Math.min(4, Math.max(0.5, next)), offsetX: 0, offsetY: 0 };
    this.renderAll();
  }

  /**
   * Map a pointer event to content coordinates, inverting the zoom
   * transform so strokes land where the user points at any zoom.
   *
   * Coordinates are intentionally NOT clamped to 0..1: at zoom < 100% the
   * board occupies only part of the surface, and clamping would smear
   * strokes along the content edge instead of letting ink follow the
   * pointer. Values outside 0..1 render consistently on every client
   * (same normalized space) and are simply clipped at each client's zoom.
   */
  private getNormPos(e: PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const scale = this.transform.scale;
    // Content point that appears at this screen position.
    const x = (px - this.transform.offsetX) / (scale * Math.max(1, rect.width));
    const y = (py - this.transform.offsetY) / (scale * Math.max(1, rect.height));
    return { x, y };
  }

  // ── Resize (devicePixelRatio-aware) ────────────────────────────
  private resize(): void {
    // Measure the CANVAS's own CSS box, not the container: the container may
    // have a border, and its border-box rect would then exceed the visible
    // canvas size — stretching content by a couple of pixels vs the pointer.
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssW = Math.max(1, rect.width);
    this.cssH = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
    this.overlay.width = this.canvas.width;
    this.overlay.height = this.canvas.height;
    this.renderAll();
  }

  private startLoop(): void {
    const tick = () => {
      this.rafId = requestAnimationFrame(tick);
      if (this.needsFullRedraw) {
        this.needsFullRedraw = false;
        this.renderAll();
      }
      if (this.overlayDirty) {
        this.overlayDirty = false;
        this.renderOverlay();
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  /** Overlay: in-progress draft (while drawing) + remote cursors. */
  private renderOverlay(): void {
    const ctx = this.overlayCtx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { scale, offsetX, offsetY } = this.transform;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offsetX, dpr * offsetY);
    ctx.clearRect(-offsetX / scale, -offsetY / scale, this.cssW / scale, this.cssH / scale);

    if (this.isDrawing && this.tool !== 'eraser') {
      if (this.isShapeTool(this.tool) && this.draftShapeStart && this.draftShapeCurrent) {
        drawOp(ctx, this.buildShapeOp() as ShapePayload, { w: this.cssW, h: this.cssH });
      } else if (this.draftPoints.length > 0) {
        const draft: StrokePayload = {
          kind: 'stroke',
          tool: this.tool === 'highlighter' ? 'highlighter' : 'pen',
          color: this.color,
          width: this.width,
          points: this.draftPoints,
          ...(this.tool === 'highlighter' ? { opacity: 0.35 } : {}),
        };
        drawOp(ctx, draft, { w: this.cssW, h: this.cssH });
      }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const cursor of this.remoteCursors.values()) {
      drawCursor(ctx, cursor.x, cursor.y, cursor.color, cursor.label);
    }
  }

  private renderAll(): void {
    const { ctx } = this;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { scale, offsetX, offsetY } = this.transform;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offsetX, dpr * offsetY);
    ctx.clearRect(-offsetX / scale, -offsetY / scale, this.cssW / scale, this.cssH / scale);
    for (const op of this.history.allOps()) {
      drawOp(ctx, op, { w: this.cssW, h: this.cssH });
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.renderOverlay();
  }

  // ── Undo / redo / export ─────────────────────────────────────
  undo(): void {
    this.history.undo();
    this.renderAll();
    this.options.onHistoryChange();
  }

  redo(): void {
    this.history.redo();
    this.renderAll();
    this.options.onHistoryChange();
  }

  canUndo(): boolean {
    return this.history.canUndo;
  }

  canRedo(): boolean {
    return this.history.canRedo;
  }

  exportPng(): string {
    // Composite onto white so transparent pixels become a white background.
    const out = document.createElement('canvas');
    out.width = this.canvas.width;
    out.height = this.canvas.height;
    const octx = out.getContext('2d');
    if (!octx) return '';
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(this.canvas, 0, 0);
    return out.toDataURL('image/png');
  }

  // ── Pointer input ────────────────────────────────────────────
  private pendingLocalOps: DrawingOp[] = [];
  private flushScheduled = false;
  private lastCursorSentAt = 0;

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    requestAnimationFrame(() => {
      this.flushScheduled = false;
      const ops = this.pendingLocalOps;
      this.pendingLocalOps = [];
      for (const op of ops) this.options.onLocalOp(op);
    });
  }

  private attachPointerHandlers(): void {
    const down = (e: PointerEvent): void => {
      // `select` is a non-drawing placeholder (object picking is future work).
      if (this.tool === 'select') return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture is best-effort (synthetic/already-released pointers).
      }

      this.isDrawing = true;
      const p = this.getNormPos(e);
      if (this.isShapeTool(this.tool)) {
        this.draftShapeStart = p;
        this.draftShapeCurrent = p;
      } else {
        this.draftPoints = [p];
      }
      this.overlayDirty = true;
    };

    const move = (e: PointerEvent): void => {
      // Cursor broadcast (throttled) whether or not we are drawing.
      const now = performance.now();
      if (now - this.lastCursorSentAt >= REMOTE_CURSOR_THROTTLE_MS) {
        this.lastCursorSentAt = now;
        const np = this.getNormPos(e);
        this.options.onCursorMove(np.x, np.y);
      }

      if (!this.isDrawing) return;

      const p = this.getNormPos(e);
      if (this.isShapeTool(this.tool)) {
        this.draftShapeCurrent = p;
      } else if (this.tool === 'eraser') {
        // Live eraser: immediately punch holes in the base canvas as the
        // pointer moves, using the same smoothing as committed strokes.
        const prev = this.draftPoints[this.draftPoints.length - 1];
        if (prev && (prev.x !== p.x || prev.y !== p.y)) {
          this.applyTransform(this.ctx);
          drawStrokeSegment(this.ctx, prev, p, undefined, {
            color: 'rgba(0,0,0,1)',
            width: this.width,
            erase: true,
          });
          this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        }
        if (!prev || (prev.x !== p.x || prev.y !== p.y)) this.draftPoints.push(p);
      } else {
        const last = this.draftPoints[this.draftPoints.length - 1];
        if (last) {
          // Skip micro-moves (< ~1px) to keep the point array small.
          const dx = (p.x - last.x) * this.cssW;
          const dy = (p.y - last.y) * this.cssH;
          if (dx * dx + dy * dy < 1) return;
          if (this.draftPoints.length >= 2000) return;
        }
        this.draftPoints.push(p);
      }
      this.overlayDirty = true;
    };

    const up = (e: PointerEvent): void => {
      try {
        if (this.canvas.hasPointerCapture(e.pointerId)) {
          this.canvas.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore — capture state is best-effort.
      }
      if (!this.isDrawing) return;
      this.isDrawing = false;

      if (this.isShapeTool(this.tool)) {
        if (this.draftShapeStart && this.draftShapeCurrent) {
          const op = this.buildShapeOp();
          if (op) this.commitLocal(op);
        }
        this.draftShapeStart = null;
        this.draftShapeCurrent = null;
      } else {
        if (this.draftPoints.length === 1) {
          // Single click → draw a dot.
          const p = this.draftPoints[0] as Point;
          this.draftPoints.push({ x: p.x + 0.001, y: p.y });
        }
        const op = this.buildStrokeOp();
        if (op) this.commitLocal(op);
        this.draftPoints = [];
      }
      this.overlayDirty = true;
    };

    this.canvas.addEventListener('pointerdown', down);
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
    this.detachFns.push(() => {
      this.canvas.removeEventListener('pointerdown', down);
      this.canvas.removeEventListener('pointermove', move);
      this.canvas.removeEventListener('pointerup', up);
      this.canvas.removeEventListener('pointercancel', up);
    });
  }

  private commitLocal(op: DrawingOp): void {
    this.history.commitLocal(op);
    this.applyTransform(this.ctx);
    drawOp(this.ctx, op, { w: this.cssW, h: this.cssH });
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.pendingLocalOps.push(op);
    this.scheduleFlush();
    this.options.onHistoryChange();
  }

  private handleRemoteOpAndDraw(op: DrawingOp): void {
    this.applyTransform(this.ctx);
    drawOp(this.ctx, op, { w: this.cssW, h: this.cssH });
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private applyTransform(ctx: CanvasRenderingContext2D): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { scale, offsetX, offsetY } = this.transform;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offsetX, dpr * offsetY);
  }

  private buildStrokeOp(): StrokePayload | null {
    if (this.draftPoints.length === 0) return null;
    return {
      kind: 'stroke',
      tool: this.tool === 'eraser' ? 'eraser' : this.tool === 'highlighter' ? 'highlighter' : 'pen',
      color: this.color,
      width: this.width,
      points: this.draftPoints,
      ...(this.tool === 'highlighter' ? { opacity: 0.35 } : {}),
    };
  }

  private buildShapeOp(): ShapePayload | null {
    if (!this.draftShapeStart || !this.draftShapeCurrent) return null;
    return {
      kind: 'shape',
      tool: this.tool as ShapePayload['tool'],
      style: this.style,
      color: this.color,
      width: this.width,
      points: [this.draftShapeStart, this.draftShapeCurrent],
    };
  }

  destroy(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    for (const fn of this.detachFns) fn();
    this.detachFns = [];
    this.canvas.remove();
    this.overlay.remove();
  }
}
