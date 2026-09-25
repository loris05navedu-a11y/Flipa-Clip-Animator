import {
  ArrowRight, Circle, Frame, Hexagon, Minus, RectangleHorizontal, RotateCcw, SquareDashed, Star, Trash2, Lasso, WandSparkles, SquareDashedMousePointer,
  Plus, Minus as MinusIcon, Crop, Combine, FlipHorizontal2,
} from 'lucide-react';
import { useT } from '../../i18n';
import { useTools, tools, type ShapeKind, type SelectMode, type SelectOp } from '../../editor/toolStore';
import { setUi, useEditorUi } from '../../editor/controller';
import * as sel from '../../editor/selectionOps';
import type { BrushTool } from '../../engine/brush/types';
import { IconButton, Segmented, SelectInput } from '../components/ui';
import { useCtrl, useSession } from './context';

function MiniSlider({ label, value, min, max, step = 1, onChange, onCommit, unit = '', scale = 1, testId, log }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; onCommit?: (v: number) => void; unit?: string; scale?: number; testId?: string; log?: boolean }) {
  // Optional logarithmic mapping for sizes (fine control of small brushes).
  const toPos = (v: number) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const fromPos = (p: number) => (log ? min * Math.pow(max / min, p) : min + p * (max - min));
  const pos = toPos(value);
  return (
    <label className="mini-slider" title={label}>
      <span className="mini-label">{label}</span>
      <input
        type="range"
        min={0}
        max={1000}
        step={1}
        value={Math.round(pos * 1000)}
        aria-label={label}
        data-testid={testId}
        style={{ ['--fill' as string]: `${pos * 100}%` }}
        onChange={(e) => {
          let v = fromPos(parseInt(e.target.value, 10) / 1000);
          v = step >= 1 ? Math.round(v) : Math.round(v / step) * step;
          onChange(Math.min(max, Math.max(min, v)));
        }}
        onPointerUp={() => onCommit?.(value)}
      />
      <span className="mini-value">
        {Math.round(value * scale * 10) / 10}
        {unit}
      </span>
    </label>
  );
}

function BrushOptions({ tool }: { tool: BrushTool }) {
  const t = useT();
  const ctrl = useCtrl();
  const presets = useTools((s) => s.presets);
  const activeId = useTools((s) => s.active[tool]);
  const preset = presets.find((p) => p.id === activeId) ?? presets.find((p) => p.tool === tool)!;
  const update = useTools((s) => s.updatePreset);
  return (
    <>
      <SelectInput
        label={t('brushes.library')}
        value={preset.id}
        testId="brush-preset"
        onChange={(id) => tools().selectPreset(tool, id)}
        options={presets.filter((p) => p.tool === tool).map((p) => ({ value: p.id, label: p.builtin ? t(p.name) : p.name }))}
      />
      <MiniSlider label={t('brush.size')} value={preset.settings.size} min={1} max={500} log step={0.5} unit="px" testId="brush-size" onChange={(v) => ctrl.setBrushSize(v)} />
      <MiniSlider label={t('brush.opacity')} value={preset.settings.opacity} min={0.01} max={1} step={0.01} scale={100} unit="%" onChange={(v) => update(preset.id, { opacity: v })} />
      <MiniSlider label={t('brush.smoothing')} value={preset.settings.smoothing} min={0} max={0.95} step={0.01} scale={100} unit="%" onChange={(v) => update(preset.id, { smoothing: v })} />
    </>
  );
}

function EraserOptions() {
  const t = useT();
  const ctrl = useCtrl();
  const s = useSession();
  const e = useTools((x) => x.eraser);
  return (
    <>
      <Segmented
        value={e.mode}
        label={t('eraser.mode')}
        onChange={(mode) => tools().setEraser({ mode })}
        options={[
          { value: 'freehand', label: t('eraser.freehand') },
          { value: 'rect', label: t('eraser.rect'), icon: SquareDashed, iconOnly: true },
          { value: 'lasso', label: t('eraser.lasso'), icon: Lasso, iconOnly: true },
        ]}
      />
      {e.mode === 'freehand' && <MiniSlider label={t('brush.size')} value={e.size} min={1} max={500} log step={0.5} unit="px" onChange={(v) => ctrl.setBrushSize(v)} />}
      <MiniSlider label={t('brush.opacity')} value={e.opacity} min={0.01} max={1} step={0.01} scale={100} unit="%" onChange={(v) => tools().setEraser({ opacity: v })} />
      <IconButton icon={Trash2} label={t('eraser.clearCel')} onClick={() => s.clearCel()} danger />
    </>
  );
}

const SHAPE_ICONS: Record<ShapeKind, typeof Minus> = { line: Minus, rect: RectangleHorizontal, ellipse: Circle, polygon: Hexagon, star: Star, arrow: ArrowRight };

function ShapeOptions() {
  const t = useT();
  const ctrl = useCtrl();
  const sh = useTools((x) => x.shape);
  return (
    <>
      <Segmented
        value={sh.kind}
        label={t('shape.kind')}
        onChange={(kind) => tools().setShape({ kind })}
        options={(Object.keys(SHAPE_ICONS) as ShapeKind[]).map((k) => ({ value: k, label: t(`shape.${k}`), icon: SHAPE_ICONS[k], iconOnly: true }))}
      />
      <MiniSlider label={t('shape.width')} value={sh.width} min={1} max={200} log step={0.5} unit="px" onChange={(v) => ctrl.setBrushSize(v)} />
      <label className="mini-check">
        <input type="checkbox" checked={sh.stroke} onChange={(e) => tools().setShape({ stroke: e.target.checked })} /> {t('shape.stroke')}
      </label>
      <label className="mini-check">
        <input type="checkbox" checked={sh.fill} onChange={(e) => tools().setShape({ fill: e.target.checked })} /> {t('shape.fill')}
      </label>
    </>
  );
}

function FillOptions() {
  const t = useT();
  const f = useTools((x) => x.fill);
  return (
    <>
      <MiniSlider label={t('fill.tolerance')} value={f.tolerance} min={0} max={100} unit="%" onChange={(v) => tools().setFill({ tolerance: v })} />
      <label className="mini-check">
        <input type="checkbox" checked={f.contiguous} onChange={(e) => tools().setFill({ contiguous: e.target.checked })} /> {t('fill.contiguous')}
      </label>
      <label className="mini-check">
        <input type="checkbox" checked={f.sampleAll} onChange={(e) => tools().setFill({ sampleAll: e.target.checked })} /> {t('fill.sampleAll')}
      </label>
    </>
  );
}

function SelectOptions() {
  const t = useT();
  const s = useSession();
  const c = useTools((x) => x.select);
  return (
    <>
      <Segmented
        value={c.mode}
        label={t('select.mode')}
        onChange={(mode: SelectMode) => tools().setSelect({ mode })}
        options={[
          { value: 'rect', label: t('select.rect'), icon: SquareDashed, iconOnly: true },
          { value: 'lasso', label: t('select.lasso'), icon: Lasso, iconOnly: true },
          { value: 'wand', label: t('select.wand'), icon: WandSparkles, iconOnly: true },
        ]}
      />
      <Segmented
        value={c.op}
        label={t('select.op')}
        onChange={(op: SelectOp) => tools().setSelect({ op })}
        options={[
          { value: 'new', label: t('select.new'), icon: SquareDashedMousePointer, iconOnly: true },
          { value: 'add', label: t('select.add'), icon: Plus, iconOnly: true },
          { value: 'subtract', label: t('select.subtract'), icon: MinusIcon, iconOnly: true },
          { value: 'intersect', label: t('select.intersect'), icon: Combine, iconOnly: true },
        ]}
      />
      {c.mode === 'wand' && <MiniSlider label={t('fill.tolerance')} value={c.tolerance} min={0} max={100} unit="%" onChange={(v) => tools().setSelect({ tolerance: v })} />}
      <IconButton icon={Crop} label={t('select.all')} onClick={() => sel.selectAll(s)} />
      <IconButton icon={FlipHorizontal2} label={t('select.invert')} onClick={() => sel.invertSelection(s)} />
    </>
  );
}

function HandOptions() {
  const t = useT();
  const ctrl = useCtrl();
  const zoom = useEditorUi((u) => u.zoom);
  const rot = useEditorUi((u) => u.rotation);
  return (
    <>
      <MiniSlider label={t('editor.zoom')} value={zoom} min={0.02} max={64} log step={0.01} scale={100} unit="%" onChange={(v) => ctrl.setZoom(v)} />
      <IconButton icon={Frame} label={t('editor.fit')} onClick={() => ctrl.fit()} />
      <button type="button" className="btn small ghost" onClick={() => ctrl.setZoom(1)}>
        100 %
      </button>
      <IconButton icon={RotateCcw} label={`${t('editor.resetRotation')} (${Math.round((rot * 180) / Math.PI)}°)`} onClick={() => ctrl.resetRotation()} />
    </>
  );
}

function RefOptions() {
  const t = useT();
  const s = useSession();
  const refId = useTools((x) => x.referenceId);
  if (!s.doc.references.length)
    return (
      <button type="button" className="btn small" onClick={() => setUi({ panelTab: 'refs' })}>
        {t('refs.add')}
      </button>
    );
  return (
    <SelectInput
      label={t('refs.title')}
      value={refId ?? ''}
      onChange={(id) => tools().set({ referenceId: id || null })}
      options={[{ value: '', label: '—' }, ...s.doc.references.map((r) => ({ value: r.id, label: r.name }))]}
    />
  );
}

export function ToolOptionsBar() {
  const t = useT();
  const tool = useTools((s) => s.tool);
  let body: React.ReactNode = null;
  switch (tool) {
    case 'brush':
    case 'pencil':
    case 'pen':
      body = <BrushOptions tool={tool} />;
      break;
    case 'eraser':
      body = <EraserOptions />;
      break;
    case 'shape':
      body = <ShapeOptions />;
      break;
    case 'fill':
      body = <FillOptions />;
      break;
    case 'select':
      body = <SelectOptions />;
      break;
    case 'hand':
      body = <HandOptions />;
      break;
    case 'reference':
      body = <RefOptions />;
      break;
    case 'eyedropper':
      body = (
        <>
          <label className="mini-check">
            <input type="checkbox" checked={useTools.getState().eyedropperSampleAll} onChange={(e) => tools().set({ eyedropperSampleAll: e.target.checked })} /> {t('eyedropper.sampleAll')}
          </label>
          <span className="small muted hide-narrow">{t('eyedropper.hint')}</span>
        </>
      );
      break;
    case 'text':
      body = <span className="small muted">{t('text.hint')}</span>;
      break;
    case 'transform':
      body = null;
  }
  if (!body) return null;
  return (
    <div className="tool-options" role="toolbar" aria-label={t(`tool.${tool}`)} data-testid="tool-options">
      {body}
    </div>
  );
}
