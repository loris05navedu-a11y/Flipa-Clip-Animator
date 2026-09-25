import { tools } from '../../editor/toolStore';
import { floatCanvas } from '../../editor/selectionOps';
import type { EditorSession } from '../../editor/EditorSession';
import { ensureFont, renderText, type TextMeta } from './text';
import { TransformTool } from './TransformTool';
import type { ToolHost, ToolPointer } from './Tool';

/** Re-render the floating text after its content or style changed. */
export async function refreshText(s: EditorSession): Promise<void> {
  const f = s.floating;
  if (!f || f.kind !== 'text') return;
  const st = tools().text;
  await ensureFont(st);
  const meta = f.meta as TextMeta;
  f.canvas = renderText(meta.text, st, tools().primary);
  s.emit('floating');
}

export async function createText(s: EditorSession, at: { x: number; y: number }, text: string): Promise<boolean> {
  const st = tools().text;
  await ensureFont(st);
  const canvas = renderText(text, st, tools().primary);
  const f = await floatCanvas(s, canvas, 'text', { x: at.x + canvas.width / 2, y: at.y + canvas.height / 2 }, { text } satisfies TextMeta);
  return !!f;
}

/** Tap to place a text block; then move / scale / rotate it like a transform. */
export class TextTool extends TransformTool {
  override readonly id = 'text' as const;
  override cursor = 'text';
  constructor(host: ToolHost, private defaultText: () => string) {
    super(host);
  }

  override activate(): void {}

  override down(p: ToolPointer): void {
    const s = this.host.session;
    const f = s.floating;
    if (f && f.kind === 'text') {
      const h = this.gizmo.hitTest(p.sx, p.sy, this.host.viewport, p.pointerType === 'touch');
      if (h) {
        this.dragging = h;
        this.gizmo.begin(h, { x: p.x, y: p.y });
        return;
      }
    }
    const blocker = s.editBlocker();
    if (blocker) return this.host.toast(blocker === 'locked' ? 'toast.layerLocked' : 'toast.layerHidden', 'error');
    void createText(s, { x: p.x, y: p.y - tools().text.size }, this.defaultText());
  }
}
