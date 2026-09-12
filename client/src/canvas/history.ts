import type { DrawingOp } from '@realtimecanvas/shared';

/**
 * Logical op history.
 *
 * Remote ops go into `base` and are never undoable locally (you only undo
 * your own actions). Local ops land on the undo stack; undo pops them to
 * redo. The full canvas re-renders from ops after each mutation.
 */
export class DrawingHistory {
  private base: DrawingOp[] = [];
  private localDone: DrawingOp[] = [];
  private localUndone: DrawingOp[] = [];

  get canUndo(): boolean {
    return this.localDone.length > 0;
  }

  get canRedo(): boolean {
    return this.localUndone.length > 0;
  }

  get localOpCount(): number {
    return this.localDone.length;
  }

  commitLocal(op: DrawingOp): void {
    this.localDone.push(op);
    this.localUndone = [];
  }

  addRemote(op: DrawingOp): void {
    this.base.push(op);
  }

  undo(): DrawingOp | null {
    const op = this.localDone.pop();
    if (!op) return null;
    this.localUndone.push(op);
    return op;
  }

  redo(): DrawingOp | null {
    const op = this.localUndone.pop();
    if (!op) return null;
    this.localDone.push(op);
    return op;
  }

  /** All ops to paint, oldest to newest. */
  allOps(): DrawingOp[] {
    return [...this.base, ...this.localDone];
  }

  clearAll(): void {
    this.base = [];
    this.localDone = [];
    this.localUndone = [];
  }
}
