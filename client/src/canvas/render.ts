import type { DrawingOp, Point, ShapePayload, StrokePayload } from '@realtimecanvas/shared';

export interface ViewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Eraser strokes are widened slightly so the erase band's solid core fully
 * covers the anti-aliased rim of the ink being erased (destination-out only
 * reduces alpha proportionally to coverage, so a same-width erase leaves a
 * faint ghost edge). Consistent across live erase, committed ops and replay
 * because every eraser path goes through this constant.
 */
export const ERASE_WIDTH_FACTOR = 1.5;

export function drawStrokeSegment(
  ctx: CanvasRenderingContext2D,
  a: Point,
  b: Point,
  next: Point | undefined,
  style: { color: string; width: number; opacity?: number; erase?: boolean }
): void {
  ctx.save();
  if (style.erase) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.strokeStyle = style.color;
    if (style.opacity !== undefined) ctx.globalAlpha = style.opacity;
  }
  ctx.lineWidth = style.erase ? style.width * ERASE_WIDTH_FACTOR : style.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  const m1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  ctx.moveTo(m1.x, m1.y);
  if (next) {
    const m2 = { x: (b.x + next.x) / 2, y: (b.y + next.y) / 2 };
    ctx.quadraticCurveTo(b.x, b.y, m2.x, m2.y);
  } else {
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  ctx.restore();
}

export function drawStrokeOp(
  ctx: CanvasRenderingContext2D,
  op: StrokePayload,
  size: { w: number; h: number }
): void {
  const pts = op.points;
  if (pts.length === 0) return;
  const px = (p: Point): Point => ({ x: p.x * size.w, y: p.y * size.h });

  ctx.save();
  ctx.lineCap = op.tool === 'highlighter' ? 'butt' : 'round';
  ctx.lineJoin = 'round';
  if (op.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.strokeStyle = op.color;
    if (op.opacity !== undefined) ctx.globalAlpha = op.opacity;
  }
  ctx.lineWidth = op.tool === 'eraser' ? op.width * ERASE_WIDTH_FACTOR : op.width;

  if (pts.length === 1) {
    const p = px(pts[0] as Point);
    ctx.beginPath();
    ctx.fillStyle = op.tool === 'eraser' ? 'rgba(0,0,0,1)' : op.color;
    ctx.arc(p.x, p.y, op.width / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  const first = px(pts[0] as Point);
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < pts.length - 1; i++) {
    const b = px(pts[i] as Point);
    const c = px(pts[i + 1] as Point);
    ctx.quadraticCurveTo(b.x, b.y, (b.x + c.x) / 2, (b.y + c.y) / 2);
  }
  const last = px(pts[pts.length - 1] as Point);
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
  ctx.restore();
}

export function drawShapeOp(
  ctx: CanvasRenderingContext2D,
  op: ShapePayload,
  size: { w: number; h: number }
): void {
  const a = op.points[0];
  const b = op.points[op.points.length - 1];
  if (!a || !b) return;
  const ax = a.x * size.w;
  const ay = a.y * size.h;
  const bx = b.x * size.w;
  const by = b.y * size.h;

  ctx.save();
  if (op.opacity !== undefined) ctx.globalAlpha = op.opacity;
  ctx.lineWidth = op.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = op.color;
  ctx.fillStyle = op.color;

  switch (op.tool) {
    case 'line':
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      break;
    case 'rectangle': {
      const x = Math.min(ax, bx);
      const y = Math.min(ay, by);
      const w = Math.abs(bx - ax);
      const h = Math.abs(by - ay);
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      if (op.style === 'fill') ctx.fill();
      else ctx.stroke();
      break;
    }
    case 'circle': {
      const cx = (ax + bx) / 2;
      const cy = (ay + by) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.abs(bx - ax) / 2, Math.abs(by - ay) / 2, 0, 0, Math.PI * 2);
      if (op.style === 'fill') ctx.fill();
      else ctx.stroke();
      break;
    }
    case 'arrow': {
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      const angle = Math.atan2(by - ay, bx - ax);
      const head = Math.max(10, op.width * 3.5);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - head * Math.cos(angle - Math.PI / 7), by - head * Math.sin(angle - Math.PI / 7));
      ctx.lineTo(bx - head * Math.cos(angle + Math.PI / 7), by - head * Math.sin(angle + Math.PI / 7));
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

export function drawOp(
  ctx: CanvasRenderingContext2D,
  op: DrawingOp,
  size: { w: number; h: number }
): void {
  if (op.kind === 'clear') return;
  if (op.kind === 'stroke') drawStrokeOp(ctx, op, size);
  else drawShapeOp(ctx, op, size);
}

export function drawCursor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  label: string
): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (label) {
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    const pad = 4;
    const w = ctx.measureText(label).width + pad * 2;
    const labelY = y - 14;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x + 8, labelY - 9, w, 16, 8);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, x + 8 + pad, labelY + 2.5);
  }
  ctx.restore();
}
