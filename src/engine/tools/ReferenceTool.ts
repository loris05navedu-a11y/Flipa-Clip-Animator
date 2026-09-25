import type { TransformParams } from '../../core/geometry/matrix';
import { tools } from '../../editor/toolStore';
import { Gizmo, pointInPolygon } from './Gizmo';
import { transformedCorners } from '../../core/geometry/matrix';
import type { Viewport } from '../Viewport';
import type { Tool, ToolHost, ToolPointer } from './Tool';

/** Move / scale / rotate reference images (they are never drawn into layers). */
export class ReferenceTool implements Tool {
  readonly id = 'reference' as const;
  cursor = 'move';
  private gizmo: Gizmo;
  private dragging = false;
  private gesture = 0;

  constructor(private host: ToolHost) {
    this.gizmo = new Gizmo(
      {
        get: () => {
          const r = this.ref()!;
          return { t: { cx: r.x, cy: r.y, sx: r.scale, sy: r.scale, rotation: r.rotation, skew: 0 }, w: r.naturalWidth, h: r.naturalHeight };
        },
        set: (t: TransformParams) => {
          const r = this.ref();
          if (!r) return;
          const scale = Math.max(0.01, Math.abs((t.sx + t.sy) / 2));
          host.session.updateReference(r.id, { x: t.cx, y: t.cy, scale, rotation: t.rotation }, `drag${this.gesture}`);
        },
      },
      { proportional: () => true, snapRotation: () => tools().transform.snapRotation, snapPoint: (p) => host.snap(p) },
    );
  }

  private ref() {
    const id = tools().referenceId;
    return this.host.session.doc.references.find((r) => r.id === id) ?? null;
  }

  down(p: ToolPointer): void {
    let r = this.ref();
    const vp = this.host.viewport;
    let handle = r && !r.locked && r.visible ? this.gizmo.hitTest(p.sx, p.sy, vp, p.pointerType === 'touch') : null;
    if (!handle) {
      // Pick the top-most reference under the pointer.
      const refs = [...this.host.session.doc.references].reverse();
      const hit = refs.find((x) => x.visible && pointInPolygon({ x: p.x, y: p.y }, transformedCorners({ cx: x.x, cy: x.y, sx: x.scale, sy: x.scale, rotation: x.rotation, skew: 0 }, x.naturalWidth, x.naturalHeight)));
      if (hit) {
        tools().set({ referenceId: hit.id });
        r = hit;
        handle = 'move';
      }
    }
    if (!r || !handle) return;
    if (r.locked) return this.host.toast('toast.referenceLocked', 'info');
    this.gesture++;
    this.dragging = true;
    this.gizmo.begin(handle, { x: p.x, y: p.y });
  }

  move(points: ToolPointer[], hover: boolean): void {
    if (hover || !this.dragging) return;
    const last = points[points.length - 1];
    this.gizmo.drag({ x: last.x, y: last.y }, last.shift);
  }

  up(): void {
    this.dragging = false;
    this.gizmo.end();
  }

  cancel(): void {
    this.up();
  }

  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    const r = this.ref();
    if (r && r.visible && !r.locked) this.gizmo.draw(ctx, vp, '#00b894');
  }
}
