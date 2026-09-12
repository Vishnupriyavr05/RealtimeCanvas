import { useEffect } from 'react';
import type { ToolId } from '@realtimecanvas/shared';

const TOOL_KEYS: Record<string, ToolId> = {
  p: 'pen',
  h: 'highlighter',
  e: 'eraser',
  l: 'line',
  r: 'rectangle',
  c: 'circle',
  a: 'arrow',
};

export interface KeyboardShortcutHandlers {
  onTool: (tool: ToolId) => void;
  onUndo: () => void;
  onRedo: () => void;
}

/** Global shortcuts; skipped while typing in inputs/textarea or with modifiers. */
export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handlers.onRedo();
        else handlers.onUndo();
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const tool = TOOL_KEYS[e.key.toLowerCase()];
      if (tool) handlers.onTool(tool);
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handlers]);
}
