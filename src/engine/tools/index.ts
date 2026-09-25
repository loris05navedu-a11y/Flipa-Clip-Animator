import { BrushTool } from './BrushTool';
import { ShapeTool } from './ShapeTool';
import { EyedropperTool, FillTool } from './FillTool';
import { SelectTool } from './SelectTool';
import { TransformTool } from './TransformTool';
import { TextTool } from './TextTool';
import { ReferenceTool } from './ReferenceTool';
import type { Tool, ToolHost, ToolId, ToolPointer } from './Tool';

class HandTool implements Tool {
  readonly id = 'hand' as const;
  cursor = 'grab';
  down(_p: ToolPointer): void {}
  move(): void {}
  up(): void {}
  cancel(): void {}
}

export function createTools(host: ToolHost, defaultText: () => string): Record<ToolId, Tool> {
  return {
    brush: new BrushTool('brush', host),
    pencil: new BrushTool('pencil', host),
    pen: new BrushTool('pen', host),
    eraser: new BrushTool('eraser', host),
    shape: new ShapeTool(host),
    fill: new FillTool(host),
    eyedropper: new EyedropperTool(host),
    select: new SelectTool(host),
    transform: new TransformTool(host),
    text: new TextTool(host, defaultText),
    hand: new HandTool(),
    reference: new ReferenceTool(host),
  };
}

export const BRUSH_FAMILY: ToolId[] = ['brush', 'pencil', 'pen', 'eraser'];
