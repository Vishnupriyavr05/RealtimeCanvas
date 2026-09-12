import {
  MousePointer2,
  Pencil,
  Highlighter,
  Eraser,
  Minus,
  Square,
  Circle,
  ArrowUpRight,
  Undo2,
  Redo2,
  Trash2,
  Download,
  ZoomIn,
  ZoomOut,
  Maximize,
} from 'lucide-react';
import type { ToolId } from '@realtimecanvas/shared';
import { PALETTE, SIZES } from '@realtimecanvas/shared';

export interface ToolbarProps {
  tool: ToolId;
  setTool: (t: ToolId) => void;
  color: string;
  setColor: (c: string) => void;
  width: number;
  setWidth: (w: number) => void;
  style: 'stroke' | 'fill';
  setStyle: (s: 'stroke' | 'fill') => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onClear: () => void;
  onExport: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
}

const TOOLS: { id: ToolId; label: string; key: string; icon: typeof Pencil }[] = [
  { id: 'select', label: 'Select', key: '', icon: MousePointer2 },
  { id: 'pen', label: 'Pen', key: 'P', icon: Pencil },
  { id: 'highlighter', label: 'Highlighter', key: 'H', icon: Highlighter },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: Eraser },
  { id: 'line', label: 'Line', key: 'L', icon: Minus },
  { id: 'rectangle', label: 'Rectangle', key: 'R', icon: Square },
  { id: 'circle', label: 'Circle', key: 'C', icon: Circle },
  { id: 'arrow', label: 'Arrow', key: 'A', icon: ArrowUpRight },
];

const SHAPE_TOOLS: readonly ToolId[] = ['line', 'rectangle', 'circle', 'arrow'];

export function Toolbar(props: ToolbarProps) {
  const { tool, setTool, color, setColor, width, setWidth, style, setStyle } = props;
  const isShape = SHAPE_TOOLS.includes(tool);

  return (
    <div className="toolbar" role="toolbar" aria-label="Drawing tools">
      <div className="tool-group" aria-label="Tools">
        {TOOLS.map(({ id, label, key, icon: Icon }) => (
          <button
            key={id}
            className={`tool-btn${tool === id ? ' active' : ''}`}
            onClick={() => setTool(id)}
            title={key ? `${label} (${key})` : label}
            aria-label={label}
            aria-pressed={tool === id}
          >
            <Icon size={16} />
          </button>
        ))}
      </div>

      <div className="tool-separator" aria-hidden />

      <div className="tool-group" aria-label="Colors">
        {PALETTE.map((c) => (
          <button
            key={c}
            className={`swatch${color === c ? ' active' : ''}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
            title={c}
            aria-label={`Color ${c}`}
            aria-pressed={color === c}
          />
        ))}
        <label className="color-picker" title="Custom color">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Custom color" />
        </label>
      </div>

      <div className="tool-separator" aria-hidden />

      <div className="tool-group" aria-label="Brush size">
        {SIZES.map((s) => (
          <button
            key={s}
            className={`size-btn${width === s ? ' active' : ''}`}
            onClick={() => setWidth(s)}
            title={`${s}px`}
            aria-label={`Brush size ${s}px`}
            aria-pressed={width === s}
          >
            <span className="size-dot" style={{ width: Math.min(20, 4 + s), height: Math.min(20, 4 + s) }} />
          </button>
        ))}
      </div>

      {isShape && (
        <>
          <div className="tool-separator" aria-hidden />
          <div className="tool-group" aria-label="Shape style">
            <button
              className={`tool-btn${style === 'stroke' ? ' active' : ''}`}
              onClick={() => setStyle('stroke')}
              title="Outline"
              aria-label="Outline style"
              aria-pressed={style === 'stroke'}
            >
              <span className="style-glyph outline" />
            </button>
            <button
              className={`tool-btn${style === 'fill' ? ' active' : ''}`}
              onClick={() => setStyle('fill')}
              title="Filled"
              aria-label="Filled style"
              aria-pressed={style === 'fill'}
            >
              <span className="style-glyph filled" />
            </button>
          </div>
        </>
      )}

      <div className="tool-spacer" />

      <div className="tool-group" aria-label="Actions">
        <button className="tool-btn" onClick={props.onUndo} disabled={!props.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
          <Undo2 size={16} />
        </button>
        <button className="tool-btn" onClick={props.onRedo} disabled={!props.canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
          <Redo2 size={16} />
        </button>
        <button className="tool-btn danger" onClick={props.onClear} title="Clear canvas" aria-label="Clear canvas">
          <Trash2 size={16} />
        </button>
        <button className="tool-btn" onClick={props.onExport} title="Export PNG" aria-label="Export PNG">
          <Download size={16} />
        </button>
      </div>

      <div className="tool-separator" aria-hidden />

      <div className="tool-group" aria-label="Zoom">
        <button className="tool-btn" onClick={props.onZoomOut} title="Zoom out" aria-label="Zoom out">
          <ZoomOut size={16} />
        </button>
        <button className="tool-btn" onClick={props.onZoomIn} title="Zoom in" aria-label="Zoom in">
          <ZoomIn size={16} />
        </button>
        <button className="tool-btn" onClick={props.onResetZoom} title="Reset zoom" aria-label="Reset zoom">
          <Maximize size={16} />
        </button>
      </div>
    </div>
  );
}
