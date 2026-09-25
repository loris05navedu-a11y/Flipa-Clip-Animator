import type { EditorSession } from '../../editor/EditorSession';
import type { Viewport } from '../Viewport';

export type ToolId =
  | 'brush'
  | 'pencil'
  | 'pen'
  | 'eraser'
  | 'shape'
  | 'fill'
  | 'eyedropper'
  | 'select'
  | 'transform'
  | 'text'
  | 'hand'
  | 'reference';

export interface ToolPointer {
  /** Project coordinates */
  x: number;
  y: number;
  /** Screen (CSS px, relative to the canvas element) */
  sx: number;
  sy: number;
  pressure: number;
  pointerType: string;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  time: number;
}

/** Services the canvas view offers to tools. */
export interface ToolHost {
  session: EditorSession;
  viewport: Viewport;
  toast(messageKey: string, kind?: 'info' | 'error' | 'success'): void;
  /** Called by tools that change the primary colour (eyedropper). */
  setColor(hex: string, which?: 'primary' | 'secondary'): void;
  /** Switch tool (e.g. after lifting a selection → transform). */
  setTool(id: ToolId): void;
  /** Snap a document point to grid / guides according to the view settings. */
  snap(p: { x: number; y: number }): { x: number; y: number };
}

export interface Tool {
  readonly id: ToolId;
  /** CSS cursor */
  cursor: string;
  down(p: ToolPointer): void;
  move(p: ToolPointer[], hover: boolean): void;
  up(p: ToolPointer): void;
  /** Abort the current gesture (second finger touched down, Escape...). */
  cancel(): void;
  /** Paint overlays in screen space. */
  drawOverlay?(ctx: CanvasRenderingContext2D, vp: Viewport): void;
  activate?(): void;
  /** Leaving the tool: commit pending work. */
  deactivate?(): void;
  /** Brush size in project px, for the cursor outline (0 = none). */
  cursorSize?(): number;
}
