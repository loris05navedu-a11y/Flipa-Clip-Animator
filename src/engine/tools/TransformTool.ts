import { tools } from '../../editor/toolStore';
import { liftSelection } from '../../editor/selectionOps';
import { Gizmo, type Handle } from './Gizmo';
import type { Viewport } from '../Viewport';
import type { Tool, ToolHost, ToolPointer } from './Tool';

/** Move / scale / rotate the floating content (lifted selection, paste, import). */
export class TransformTool implements Tool {
  readonly id: 'transform' | 'text' = 'transform';
  cursor = 'move';
  protected gizmo: Gizmo;
  protected dragging: Handle | null = null;

  constructor(protected host: ToolHost) {
    this.gizmo = new Gizmo(
      {
        get: () => {
          const f = host.session.floating!;
          return { t: f.t, w: f.canvas.width, h: f.canvas.height };
        },
        set: (t) => {
          const f = host.session.floating;
          if (!f) return;
          f.t = t;
          host.session.emit('floating');
        },
      },
      {
        proportional: () => tools().transform.proportional,
        snapRotation: () => tools().transform.snapRotation,
        snapPoint: (p) => host.snap(p),
      },
    );
  }

  activate(): void {
    const s = this.host.session;
    if (s.floating) return;
    const blocker = s.editBlocker();
    if (blocker) {
      this.host.toast(blocker === 'locked' ? 'toast.layerLocked' : 'toast.layerHidden', 'error');
      return;
    }
    void liftSelection(s).then((f) => {
      if (!f) this.host.toast('toast.nothingToTransform', 'info');
    });
  }

  deactivate(): void {
    void this.host.session.commitFloating();
  }

  down(p: ToolPointer): void {
    if (!this.host.session.floating) return;
    const h = this.gizmo.hitTest(p.sx, p.sy, this.host.viewport, p.pointerType === 'touch') ?? 'move';
    this.dragging = h;
    this.gizmo.begin(h, { x: p.x, y: p.y });
  }

  move(points: ToolPointer[], hover: boolean): void {
    if (hover || !this.dragging) return;
    const last = points[points.length - 1];
    this.gizmo.drag({ x: last.x, y: last.y }, last.shift);
  }

  up(): void {
    this.dragging = null;
    this.gizmo.end();
  }

  cancel(): void {
    this.dragging = null;
    this.gizmo.end();
  }

  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    if (this.host.session.floating) this.gizmo.draw(ctx, vp, vp.theme.accent);
  }
}
