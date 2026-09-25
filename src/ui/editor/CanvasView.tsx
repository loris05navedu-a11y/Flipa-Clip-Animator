import { useEffect, useRef } from 'react';
import { snapValue } from '../../core/geometry/matrix';
import { uid } from '../../core/util/id';
import { useEditorUi, type EditorController } from '../../editor/controller';
import { heldKeys } from '../../editor/keys';
import { tools, useTools } from '../../editor/toolStore';
import { Viewport } from '../../engine/Viewport';
import { createTools, BRUSH_FAMILY } from '../../engine/tools';
import type { Tool, ToolHost, ToolPointer } from '../../engine/tools/Tool';
import { settings } from '../../storage/settings';
import { t } from '../../i18n';
import { toast } from '../components/toast';
import { importDroppedFiles } from './importActions';

interface Ptr {
  x: number;
  y: number;
  sx: number;
  sy: number;
  type: string;
  t: number;
}

type Mode = 'none' | 'tool' | 'gesture' | 'pan' | 'guide' | 'longpress' | 'symcenter';

/** The drawing surface: owns the Viewport and routes input to tools and gestures. */
export function CanvasView({ ctrl, dark }: { ctrl: EditorController; dark: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tool = useTools((s) => s.tool);
  const s = ctrl.session;

  // Mutable input state kept outside React.
  const st = useRef({
    vp: null as Viewport | null,
    tools: null as Record<string, Tool> | null,
    active: null as Tool | null,
    mode: 'none' as Mode,
    ptrs: new Map<number, Ptr>(),
    gesture: null as null | { cx: number; cy: number; dist: number; angle: number; start: number; moved: number; count: number },
    toolPointer: -1,
    lastPen: 0,
    longPress: 0 as number | ReturnType<typeof setTimeout>,
    downAt: null as Ptr | null,
    guide: null as null | { id: string; axis: 'x' | 'y'; isNew: boolean },
  });

  // Create viewport + tools once per session.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const vp = new Viewport(canvas, s);
    ctrl.viewport = vp;
    st.current.vp = vp;
    (s as unknown as { __vp: Viewport }).__vp = vp;
    (s as unknown as { __tool: () => string | undefined }).__tool = () => st.current.active?.id;
    const host: ToolHost = {
      session: s,
      viewport: vp,
      toast: (k, kind) => toast(k, kind),
      setColor: (hex, which) => ctrl.setColor(hex, which),
      setTool: (id) => ctrl.setTool(id),
      snap: (p) => snapPoint(p, vp),
    };
    const all = createTools(host, () => t('text.default'));
    st.current.tools = all;
    const initial = all[tools().tool] ?? all.brush;
    st.current.active = initial;
    vp.overlay = initial as never;
    initial.activate?.();

    const ro = new ResizeObserver(() => {
      const r = wrapRef.current!.getBoundingClientRect();
      const first = vp.view.viewW <= 1;
      vp.resize(r.width, r.height);
      if (first) ctrl.fit();
    });
    ro.observe(wrapRef.current!);
    const off = s.changed.on((kind) => {
      if (kind === 'doc') vp.syncDocSize();
      vp.requestRender();
    });
    const offTool = ctrl.onToolChange(() => undefined);
    // Animate marching ants while a selection exists.
    let raf = 0;
    const ants = () => {
      if (s.selection && !s.floating) vp.requestRender();
      raf = window.setTimeout(ants, 120) as unknown as number;
    };
    ants();
    return () => {
      ro.disconnect();
      off();
      offTool();
      clearTimeout(raf);
      st.current.active?.deactivate?.();
      vp.dispose();
      ctrl.viewport = null;
    };
  }, [s, ctrl]);

  // Switch tools.
  useEffect(() => {
    const all = st.current.tools;
    const vp = st.current.vp;
    if (!all || !vp) return;
    const next = all[tool];
    if (next === st.current.active) return;
    if (st.current.mode === 'tool') {
      st.current.active?.cancel();
      st.current.mode = 'none';
    }
    st.current.active?.deactivate?.();
    st.current.active = next;
    vp.overlay = next as never;
    vp.cursor = null;
    next.activate?.();
    vp.requestRender();
  }, [tool]);

  useEffect(() => {
    const vp = st.current.vp;
    if (!vp) return;
    const css = getComputedStyle(document.documentElement);
    vp.theme = { workspace: css.getPropertyValue('--workspace').trim() || '#1d1d24', dark, accent: css.getPropertyValue('--accent').trim() || '#6c5ce7' };
    vp.requestRender();
  }, [dark]);

  const toPtr = (e: { clientX: number; clientY: number; pointerType: string; timeStamp: number }): Ptr => {
    const r = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - r.left,
      sy = e.clientY - r.top;
    const d = st.current.vp!.view.toDoc({ x: sx, y: sy });
    return { x: d.x, y: d.y, sx, sy, type: e.pointerType, t: e.timeStamp };
  };

  const toolPointer = (e: PointerEvent | React.PointerEvent, p: Ptr): ToolPointer => ({
    x: p.x,
    y: p.y,
    sx: p.sx,
    sy: p.sy,
    pressure: e.pointerType === 'pen' ? (e.pressure > 0 ? e.pressure : 0.5) : 1,
    pointerType: e.pointerType,
    shift: e.shiftKey,
    alt: e.altKey,
    ctrl: e.ctrlKey || e.metaKey,
    time: e.timeStamp,
  });

  const touchNavigates = (e: React.PointerEvent): boolean =>
    e.pointerType === 'touch' && (settings().stylusOnly || performance.now() - st.current.lastPen < 3000);

  const startGesture = () => {
    const pts = [...st.current.ptrs.values()];
    const [a, b] = pts;
    const g = st.current.gesture;
    st.current.gesture = {
      cx: (a.sx + b.sx) / 2,
      cy: (a.sy + b.sy) / 2,
      dist: Math.hypot(b.sx - a.sx, b.sy - a.sy),
      angle: Math.atan2(b.sy - a.sy, b.sx - a.sx),
      start: g?.start ?? performance.now(),
      moved: g?.moved ?? 0,
      count: Math.max(g?.count ?? 0, pts.length),
    };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = st.current;
    const vp = c.vp!;
    if (e.pointerType === 'pen') c.lastPen = performance.now();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toPtr(e);
    c.ptrs.set(e.pointerId, p);
    ctrl.stopPlayback();

    if (c.ptrs.size >= 2) {
      // Second finger: abort a just-started stroke and start navigating.
      if (c.mode === 'tool' || c.mode === 'longpress') {
        c.active?.cancel();
        clearTimeout(c.longPress as number);
      }
      if (c.mode !== 'pan' && c.mode !== 'guide') {
        c.mode = 'gesture';
        startGesture();
      }
      return;
    }
    c.gesture = null;
    c.downAt = p;

    // Rulers: drag out a new guide.
    const rs = vp.rulerSize;
    if (rs && (p.sx < rs || p.sy < rs) && e.button === 0) {
      const axis: 'x' | 'y' = p.sy < rs && p.sx >= rs ? 'y' : 'x';
      const id = uid('g');
      s.updateView({ guides: [...s.doc.view.guides, { id, axis, pos: axis === 'x' ? p.x : p.y }], guidesVisible: true });
      c.guide = { id, axis, isNew: true };
      c.mode = 'guide';
      return;
    }
    // Existing guide under the pointer (when rulers are shown).
    if (rs && s.doc.view.guidesVisible) {
      const hit = s.doc.view.guides.find((g) => {
        const sp = vp.screenOf(g.axis === 'x' ? g.pos : p.x, g.axis === 'y' ? g.pos : p.y);
        return g.axis === 'x' ? Math.abs(sp.x - p.sx) < 6 : Math.abs(sp.y - p.sy) < 6;
      });
      if (hit && (tools().tool === 'hand' || tools().tool === 'select' || tools().tool === 'transform')) {
        c.guide = { id: hit.id, axis: hit.axis, isNew: false };
        c.mode = 'guide';
        return;
      }
    }
    // Symmetry centre handle (hand tool).
    const sym = s.doc.view.symmetry;
    if (sym.mode !== 'off' && sym.visible && tools().tool === 'hand') {
      const sp = vp.screenOf(sym.cx, sym.cy);
      if (Math.hypot(sp.x - p.sx, sp.y - p.sy) < 16) {
        c.mode = 'symcenter';
        return;
      }
    }
    if (tools().tool === 'hand' || heldKeys.space || e.button === 1 || touchNavigates(e)) {
      if (heldKeys.space) heldKeys.spaceUsed = true;
      c.mode = 'pan';
      return;
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    // Alt + brush = temporary eyedropper (desktop).
    if (e.altKey && BRUSH_FAMILY.includes(tools().tool)) {
      c.mode = 'longpress';
      c.tools!.eyedropper.down(toolPointer(e, p));
      return;
    }
    c.mode = 'tool';
    c.toolPointer = e.pointerId;
    c.active!.down(toolPointer(e, p));
    // Long press with a brush on touch = eyedropper.
    if (e.pointerType === 'touch' && BRUSH_FAMILY.includes(tools().tool)) {
      c.longPress = setTimeout(() => {
        const cur = c.ptrs.get(e.pointerId);
        if (c.mode !== 'tool' || !cur || !c.downAt || Math.hypot(cur.sx - c.downAt.sx, cur.sy - c.downAt.sy) > 10) return;
        c.active!.cancel();
        c.mode = 'longpress';
        c.tools!.eyedropper.down({ ...toolPointer(e, cur), pointerType: 'touch' });
      }, 550);
    }
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = st.current;
    const vp = c.vp!;
    const p = toPtr(e);
    const prev = c.ptrs.get(e.pointerId);
    if (prev) c.ptrs.set(e.pointerId, p);
    switch (c.mode) {
      case 'tool': {
        if (e.pointerId !== c.toolPointer) return;
        const events = (e.nativeEvent.getCoalescedEvents?.() ?? []).filter((x) => x.pointerId === e.pointerId);
        const list = (events.length ? events : [e.nativeEvent]).map((ev) => toolPointer(ev, toPtr(ev)));
        c.active!.move(list, false);
        if (c.downAt && Math.hypot(p.sx - c.downAt.sx, p.sy - c.downAt.sy) > 10) clearTimeout(c.longPress as number);
        return;
      }
      case 'longpress':
        c.tools!.eyedropper.move([toolPointer(e, p)], false);
        return;
      case 'pan':
        if (prev) {
          vp.view.panBy(p.sx - prev.sx, p.sy - prev.sy);
          ctrl.syncView();
        }
        return;
      case 'guide': {
        const g = c.guide!;
        s.updateView({ guides: s.doc.view.guides.map((x) => (x.id === g.id ? { ...x, pos: Math.round(g.axis === 'x' ? p.x : p.y) } : x)) });
        return;
      }
      case 'symcenter': {
        const sym = s.doc.view.symmetry;
        const q = snapPoint({ x: p.x, y: p.y }, vp);
        s.updateView({ symmetry: { ...sym, cx: Math.max(0, Math.min(s.doc.width, q.x)), cy: Math.max(0, Math.min(s.doc.height, q.y)) } });
        return;
      }
      case 'gesture': {
        if (c.ptrs.size < 2 || !c.gesture) return;
        const [a, b] = [...c.ptrs.values()];
        const cx = (a.sx + b.sx) / 2,
          cy = (a.sy + b.sy) / 2;
        const dist = Math.hypot(b.sx - a.sx, b.sy - a.sy);
        const angle = Math.atan2(b.sy - a.sy, b.sx - a.sx);
        const g = c.gesture;
        vp.view.panBy(cx - g.cx, cy - g.cy);
        if (g.dist > 10 && dist > 10) vp.view.zoomAt(dist / g.dist, { x: cx, y: cy });
        if (settings().gestureRotate) {
          let da = angle - g.angle;
          if (da > Math.PI) da -= Math.PI * 2;
          if (da < -Math.PI) da += Math.PI * 2;
          vp.view.rotateAt(da, { x: cx, y: cy });
        }
        g.moved += Math.hypot(cx - g.cx, cy - g.cy) + Math.abs(dist - g.dist);
        g.cx = cx;
        g.cy = cy;
        g.dist = dist;
        g.angle = angle;
        ctrl.syncView();
        return;
      }
      default: {
        // Hover (mouse / pen): brush outline and previews.
        if (e.pointerType !== 'touch') c.active?.move([toolPointer(e, p)], true);
      }
    }
  };

  const finishRotationSnap = () => {
    const vp = st.current.vp!;
    const r = vp.view.rotation;
    const snaps = [0, Math.PI / 2, Math.PI, -Math.PI / 2, -Math.PI];
    for (const a of snaps)
      if (Math.abs(r - a) < 0.06) {
        vp.view.rotateAt(a - r, { x: vp.view.viewW / 2, y: vp.view.viewH / 2 });
        ctrl.syncView();
      }
  };

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = st.current;
    const p = toPtr(e);
    c.ptrs.delete(e.pointerId);
    clearTimeout(c.longPress as number);
    switch (c.mode) {
      case 'tool':
        if (e.pointerId === c.toolPointer) {
          c.active!.up(toolPointer(e, p));
          c.mode = 'none';
        }
        break;
      case 'longpress':
        c.tools!.eyedropper.up({ ...toolPointer(e, p), alt: false });
        c.mode = 'none';
        break;
      case 'guide': {
        const g = c.guide!;
        const rs = c.vp!.rulerSize;
        if (rs && (p.sx < rs || p.sy < rs)) s.updateView({ guides: s.doc.view.guides.filter((x) => x.id !== g.id) });
        c.guide = null;
        c.mode = 'none';
        break;
      }
      case 'gesture':
        if (c.ptrs.size === 0) {
          const g = c.gesture;
          if (g && performance.now() - g.start < 320 && g.moved < 24) {
            const action = g.count >= 3 ? settings().threeFingerTap : settings().twoFingerTap;
            ctrl.gesture(action);
          }
          finishRotationSnap();
          c.gesture = null;
          c.mode = 'none';
        } else if (c.ptrs.size >= 2) startGesture();
        break;
      default:
        if (c.ptrs.size === 0) c.mode = 'none';
    }
  };

  const onCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = st.current;
    c.ptrs.delete(e.pointerId);
    clearTimeout(c.longPress as number);
    if (c.mode === 'tool') c.active?.cancel();
    if (c.mode === 'longpress') c.tools!.eyedropper.cancel();
    if (c.ptrs.size === 0) c.mode = 'none';
  };

  const onWheel = (e: React.WheelEvent) => {
    const vp = st.current.vp!;
    const r = canvasRef.current!.getBoundingClientRect();
    const at = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (e.ctrlKey || e.metaKey) vp.view.zoomAt(Math.exp(-e.deltaY * 0.01), at);
    else if (e.altKey) vp.view.rotateAt(e.deltaY * 0.002, at);
    else if (e.shiftKey) vp.view.panBy(-e.deltaY, 0);
    else vp.view.panBy(-e.deltaX, -e.deltaY);
    ctrl.syncView();
  };

  const fullscreen = useEditorUi((u) => u.fullscreen);
  void fullscreen;

  return (
    <div
      ref={wrapRef}
      className="canvas-wrap"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        const files = [...e.dataTransfer.files];
        if (files.length) void importDroppedFiles(ctrl, files);
      }}
    >
      <canvas
        ref={canvasRef}
        className="main-canvas"
        data-testid="main-canvas"
        style={{ cursor: cursorFor(tool) }}
        role="img"
        aria-label={t('editor.frameCounter', { n: s.frameIndex + 1, total: s.doc.frames.length })}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onPointerLeave={(e) => {
          if (e.pointerType !== 'touch' && st.current.mode === 'none' && st.current.vp) {
            st.current.vp.cursor = null;
            st.current.vp.requestRender();
          }
        }}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}

function cursorFor(tool: string): string {
  switch (tool) {
    case 'brush':
    case 'pencil':
    case 'pen':
    case 'eraser':
      return 'crosshair';
    case 'hand':
      return 'grab';
    case 'transform':
    case 'reference':
      return 'move';
    case 'text':
      return 'text';
    default:
      return 'crosshair';
  }
}

/** Snap a document point to grid lines, guides, canvas edges and centre. */
export function snapPoint(p: { x: number; y: number }, vp: Viewport): { x: number; y: number } {
  const s = vp.session;
  const v = s.doc.view;
  const th = 8 / vp.view.zoom;
  const xs: number[] = [0, s.doc.width, s.doc.width / 2];
  const ys: number[] = [0, s.doc.height, s.doc.height / 2];
  let x = p.x,
    y = p.y;
  if (v.snapGuides && v.guidesVisible) {
    for (const g of v.guides) (g.axis === 'x' ? xs : ys).push(g.pos);
  }
  if (v.grid.enabled && v.grid.snap) {
    const gs = v.grid.size;
    xs.push(Math.round(p.x / gs) * gs);
    ys.push(Math.round(p.y / gs) * gs);
  }
  if (v.snapGuides || (v.grid.enabled && v.grid.snap)) {
    x = snapValue(p.x, xs, th);
    y = snapValue(p.y, ys, th);
  }
  return { x, y };
}
