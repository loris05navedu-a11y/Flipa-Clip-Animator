import { AlignCenter, AlignLeft, AlignRight, Bold, Copy, Italic, Pencil, Plus, RotateCcw, Trash2, Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { hexToCss } from '../../core/color/color';
import { useT } from '../../i18n';
import { tools, useTools, type TextSettings } from '../../editor/toolStore';
import { Stroke } from '../../engine/brush/Stroke';
import { eraserToBrush, type BrushSettings, type BrushTool } from '../../engine/brush/types';
import { identity } from '../../core/geometry/matrix';
import { ctx2d } from '../../engine/canvas';
import { FONTS, type TextMeta } from '../../engine/tools/text';
import { refreshText } from '../../engine/tools/TextTool';
import { dialogs } from '../components/dialogs';
import { ColorField } from '../components/ColorField';
import { Button, IconButton, Segmented, SelectInput, Slider, Toggle } from '../components/ui';
import { useCtrl, useSession } from './context';
import { TOOL_ICONS } from './ToolRail';

/** Live preview of a brush: an S-curve with simulated pen pressure. */
function BrushPreview({ settings, color, erase }: { settings: BrushSettings; color: string; erase?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = 560;
    c.height = 140;
    const ctx = ctx2d(c);
    ctx.clearRect(0, 0, c.width, c.height);
    if (erase) {
      ctx.fillStyle = '#888';
      ctx.fillRect(0, 0, c.width, c.height);
    }
    const s = { ...settings, size: Math.min(settings.size, 60), stabilizer: 0 };
    const stroke = new Stroke({ target: c, settings: s, color: hexToCss(color), erase: !!erase, symmetry: [identity()], clipMask: null, zoom: 1, usePressure: true });
    const pts = [];
    for (let i = 0; i <= 80; i++) {
      const u = i / 80;
      pts.push({ x: 40 + u * 480, y: 70 + Math.sin(u * Math.PI * 2) * 34, pressure: Math.sin(u * Math.PI) * 0.9 + 0.1 });
    }
    stroke.add(pts);
    stroke.end();
  }, [settings, color, erase]);
  return <canvas ref={ref} className="brush-preview" aria-label="preview" />;
}

function BrushEditor({ tool }: { tool: BrushTool }) {
  const t = useT();
  const ctrl = useCtrl();
  const presets = useTools((s) => s.presets);
  const activeId = useTools((s) => s.active[tool]);
  const primary = useTools((s) => s.primary);
  const preset = presets.find((p) => p.id === activeId) ?? presets.find((p) => p.tool === tool)!;
  const st = preset.settings;
  const set = (patch: Partial<BrushSettings>) => tools().updatePreset(preset.id, patch);
  const name = (p: typeof preset) => (p.builtin ? t(p.name) : p.name);

  return (
    <div className="col">
      <div className="section-title">{t('brushes.library')}</div>
      <div className="preset-list" role="listbox" aria-label={t('brushes.library')}>
        {presets
          .filter((p) => p.tool === tool)
          .map((p) => (
            <button key={p.id} type="button" role="option" aria-selected={p.id === preset.id} className={`preset-item${p.id === preset.id ? ' on' : ''}`} onClick={() => tools().selectPreset(tool, p.id)}>
              <span className="ellipsis">{name(p)}</span>
              {p.builtin && <span className="faint small">{t('brushes.builtin')}</span>}
            </button>
          ))}
      </div>
      <div className="row wrap">
        <IconButton icon={Plus} small label={t('brushes.new')} testId="brush-new" onClick={async () => { const n = await dialogs.prompt(t('brushes.new'), t('common.name'), t('brushes.newName')); if (n) tools().createPreset(tool, n); }} />
        <IconButton icon={Copy} small label={t('brushes.duplicate')} onClick={() => tools().duplicatePreset(preset.id, `${name(preset)} 2`)} />
        <IconButton icon={Pencil} small label={t('brushes.rename')} disabled={preset.builtin} onClick={async () => { const n = await dialogs.prompt(t('brushes.rename'), t('common.name'), preset.name); if (n) tools().renamePreset(preset.id, n); }} />
        <IconButton icon={RotateCcw} small label={t('brushes.reset')} disabled={!preset.builtin} onClick={() => tools().resetPreset(preset.id)} />
        <IconButton icon={Trash2} small danger label={t('brushes.delete')} disabled={preset.builtin} onClick={async () => { if (await dialogs.confirm(t('brushes.delete'), t('brushes.deleteConfirm', { name: name(preset) }), t('common.delete'), true)) tools().deletePreset(preset.id); }} />
      </div>
      <BrushPreview settings={st} color={primary} />
      <div className="section-title">{t('brush.sectionBasics')}</div>
      <Slider label={t('brush.size')} value={st.size} min={1} max={500} step={0.5} unit=" px" onChange={(v) => ctrl.setBrushSize(v)} testId="brush-size-panel" />
      <Slider label={t('brush.opacity')} value={st.opacity} min={0.01} max={1} step={0.01} scale={100} unit=" %" onChange={(v) => set({ opacity: v })} />
      <Slider label={t('brush.flow')} value={st.flow} min={0.01} max={1} step={0.01} scale={100} unit=" %" onChange={(v) => set({ flow: v })} />
      <Slider label={t('brush.hardness')} value={st.hardness} min={0} max={1} step={0.01} scale={100} unit=" %" onChange={(v) => set({ hardness: v })} />
      <Slider label={t('brush.spacing')} value={st.spacing} min={0.01} max={2} step={0.01} scale={100} unit=" %" onChange={(v) => set({ spacing: v })} />
      <Slider label={t('brush.smoothing')} value={st.smoothing} min={0} max={0.95} step={0.01} scale={100} unit=" %" onChange={(v) => set({ smoothing: v })} />
      <Slider label={t('brush.stabilizer')} value={st.stabilizer} min={0} max={1} step={0.01} scale={100} unit=" %" onChange={(v) => set({ stabilizer: v })} />
      <div className="section-title">{t('brush.sectionDynamics')}</div>
      <Toggle label={t('brush.pressureSize')} checked={st.pressureSize} onChange={(v) => set({ pressureSize: v })} />
      <Toggle label={t('brush.pressureOpacity')} checked={st.pressureOpacity} onChange={(v) => set({ pressureOpacity: v })} />
      <Slider label={t('brush.sensitivity')} value={st.sensitivity} min={0.2} max={4} step={0.05} onChange={(v) => set({ sensitivity: v })} />
      <Slider label={t('brush.minSize')} value={st.minSize} min={0} max={1} step={0.01} scale={100} unit=" %" onChange={(v) => set({ minSize: v })} />
      <Slider label={t('brush.taper')} value={st.taper} min={0} max={200} unit=" px" onChange={(v) => set({ taper: v })} />
      <div className="section-title">{t('brush.sectionTip')}</div>
      <Segmented value={st.shape} label={t('brush.shape')} onChange={(shape) => set({ shape })} options={[{ value: 'round', label: t('brush.shapeRound') }, { value: 'square', label: t('brush.shapeSquare') }]} />
      <Slider label={t('brush.roundness')} value={st.roundness} min={0.05} max={1} step={0.01} scale={100} unit=" %" onChange={(v) => set({ roundness: v })} />
      <Slider label={t('brush.angle')} value={st.angle} min={-180} max={180} unit="°" onChange={(v) => set({ angle: v })} />
      <Toggle label={t('brush.antialias')} checked={st.antialias} onChange={(v) => set({ antialias: v })} />
      <div className="section-title">{t('brush.sectionTexture')}</div>
      <Slider label={t('brush.grain')} value={st.grain} min={0} max={1} step={0.01} scale={100} unit=" %" onChange={(v) => set({ grain: v })} />
      <Slider label={t('brush.sizeJitter')} value={st.sizeJitter} min={0} max={1} step={0.01} scale={100} unit=" %" onChange={(v) => set({ sizeJitter: v })} />
      <Slider label={t('brush.opacityJitter')} value={st.opacityJitter} min={0} max={1} step={0.01} scale={100} unit=" %" onChange={(v) => set({ opacityJitter: v })} />
      <Slider label={t('brush.scatter')} value={st.scatter} min={0} max={3} step={0.01} scale={100} unit=" %" onChange={(v) => set({ scatter: v })} />
    </div>
  );
}

function EraserEditor() {
  const t = useT();
  const ctrl = useCtrl();
  const e = useTools((x) => x.eraser);
  const set = tools().setEraser;
  return (
    <div className="col">
      <Segmented value={e.mode} label={t('eraser.mode')} full onChange={(mode) => set({ mode })} options={[{ value: 'freehand', label: t('eraser.freehand') }, { value: 'rect', label: t('eraser.rect') }, { value: 'lasso', label: t('eraser.lasso') }]} />
      {e.mode === 'freehand' && <BrushPreview settings={eraserToBrush(e)} color="#000000ff" erase />}
      <Slider label={t('brush.size')} value={e.size} min={1} max={500} step={0.5} unit=" px" onChange={(v) => ctrl.setBrushSize(v)} />
      <Slider label={t('brush.opacity')} value={e.opacity} min={0.01} max={1} step={0.01} scale={100} unit=" %" onChange={(v) => set({ opacity: v })} />
      <Slider label={t('brush.hardness')} value={e.hardness} min={0} max={1} step={0.01} scale={100} unit=" %" onChange={(v) => set({ hardness: v })} />
      <Segmented value={e.shape} label={t('brush.shape')} onChange={(shape) => set({ shape })} options={[{ value: 'round', label: t('brush.shapeRound') }, { value: 'square', label: t('brush.shapeSquare') }]} />
      <Slider label={t('brush.smoothing')} value={e.smoothing} min={0} max={0.95} step={0.01} scale={100} unit=" %" onChange={(v) => set({ smoothing: v })} />
      <Slider label={t('brush.stabilizer')} value={e.stabilizer} min={0} max={1} step={0.01} scale={100} unit=" %" onChange={(v) => set({ stabilizer: v })} />
      <Toggle label={t('brush.pressureSize')} checked={e.pressureSize} onChange={(v) => set({ pressureSize: v })} />
    </div>
  );
}

function ShapeEditor() {
  const t = useT();
  const sh = useTools((x) => x.shape);
  const set = tools().setShape;
  return (
    <div className="col">
      <SelectInput label={t('shape.kind')} value={sh.kind} onChange={(kind) => set({ kind })} options={(['line', 'rect', 'ellipse', 'polygon', 'star', 'arrow'] as const).map((k) => ({ value: k, label: t(`shape.${k}`) }))} />
      <Slider label={t('shape.width')} value={sh.width} min={1} max={200} step={0.5} unit=" px" onChange={(v) => set({ width: v })} />
      <Slider label={t('common.opacity')} value={sh.opacity} min={0.01} max={1} step={0.01} scale={100} unit=" %" onChange={(v) => set({ opacity: v })} />
      <Toggle label={t('shape.stroke')} checked={sh.stroke} onChange={(v) => set({ stroke: v })} />
      <Toggle label={t('shape.fill')} checked={sh.fill} onChange={(v) => set({ fill: v })} />
      {(sh.kind === 'polygon' || sh.kind === 'star') && <Slider label={t('shape.sides')} value={sh.sides} min={3} max={24} onChange={(v) => set({ sides: v })} />}
      {sh.kind === 'star' && <Slider label={t('shape.inner')} value={sh.innerRatio} min={0.1} max={0.95} step={0.01} scale={100} unit=" %" onChange={(v) => set({ innerRatio: v })} />}
      {sh.kind === 'rect' && <Slider label={t('shape.radius')} value={sh.radius} min={0} max={200} unit=" px" onChange={(v) => set({ radius: v })} />}
      <Toggle label={t('shape.fromCenter')} checked={sh.fromCenter} onChange={(v) => set({ fromCenter: v })} />
      <Toggle label={t('shape.constrain')} checked={sh.constrain} onChange={(v) => set({ constrain: v })} />
    </div>
  );
}

function FillEditor() {
  const t = useT();
  const f = useTools((x) => x.fill);
  const set = tools().setFill;
  return (
    <div className="col">
      <Slider label={t('fill.tolerance')} value={f.tolerance} min={0} max={100} unit=" %" onChange={(v) => set({ tolerance: v })} />
      <Slider label={t('fill.grow')} value={f.grow} min={0} max={8} unit=" px" onChange={(v) => set({ grow: v })} />
      <Slider label={t('common.opacity')} value={f.opacity} min={0.01} max={1} step={0.01} scale={100} unit=" %" onChange={(v) => set({ opacity: v })} />
      <Toggle label={t('fill.contiguous')} checked={f.contiguous} onChange={(v) => set({ contiguous: v })} />
      <Toggle label={t('fill.sampleAll')} checked={f.sampleAll} onChange={(v) => set({ sampleAll: v })} />
    </div>
  );
}

function SelectEditor() {
  const t = useT();
  const c = useTools((x) => x.select);
  const set = tools().setSelect;
  return (
    <div className="col">
      <Segmented value={c.mode} label={t('select.mode')} full onChange={(mode) => set({ mode })} options={[{ value: 'rect', label: t('select.rect') }, { value: 'lasso', label: t('select.lasso') }, { value: 'wand', label: t('select.wand') }]} />
      <Segmented value={c.op} label={t('select.op')} full onChange={(op) => set({ op })} options={[{ value: 'new', label: t('select.new') }, { value: 'add', label: t('select.add') }, { value: 'subtract', label: t('select.subtract') }, { value: 'intersect', label: t('select.intersect') }]} />
      <Slider label={t('fill.tolerance')} value={c.tolerance} min={0} max={100} unit=" %" onChange={(v) => set({ tolerance: v })} />
      <Toggle label={t('fill.contiguous')} checked={c.contiguous} onChange={(v) => set({ contiguous: v })} />
      <Toggle label={t('fill.sampleAll')} checked={c.sampleAll} onChange={(v) => set({ sampleAll: v })} />
      <div className="small muted">{t('select.hint')}</div>
    </div>
  );
}

function TransformEditor() {
  const t = useT();
  const tr = useTools((x) => x.transform);
  return (
    <div className="col">
      <Toggle label={t('transform.proportional')} checked={tr.proportional} onChange={(v) => tools().setTransform({ proportional: v })} />
      <Toggle label={t('transform.snapRotation')} checked={tr.snapRotation} onChange={(v) => tools().setTransform({ snapRotation: v })} />
    </div>
  );
}

function TextEditor() {
  const t = useT();
  const s = useSession();
  const ts = useTools((x) => x.text);
  const f = s.floating && s.floating.kind === 'text' ? s.floating : null;
  const [text, setText] = useState((f?.meta as TextMeta | undefined)?.text ?? t('text.default'));
  useEffect(() => {
    if (f) setText((f.meta as TextMeta).text);
  }, [f]);
  const set = (patch: Partial<TextSettings>) => {
    tools().setText(patch);
    void refreshText(s);
  };
  return (
    <div className="col">
      <div className="field">
        <label htmlFor="text-content">{t('text.content')}</label>
        <textarea
          id="text-content"
          className="input"
          value={text}
          data-testid="text-content"
          disabled={!f}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            setText(e.target.value);
            if (f) {
              (f.meta as TextMeta).text = e.target.value;
              void refreshText(s);
            }
          }}
        />
        {!f && <div className="small muted">{t('text.hint')}</div>}
      </div>
      <div className="field">
        <label>{t('text.font')}</label>
        <SelectInput label={t('text.font')} value={ts.font} onChange={(font) => set({ font })} options={FONTS.map((x) => ({ value: x.family, label: x.label }))} />
      </div>
      <Slider label={t('text.size')} value={ts.size} min={6} max={600} unit=" px" onChange={(size) => set({ size })} />
      <div className="row wrap">
        <IconButton icon={Bold} label={t('text.bold')} toggled={ts.bold} onClick={() => set({ bold: !ts.bold })} />
        <IconButton icon={Italic} label={t('text.italic')} toggled={ts.italic} onClick={() => set({ italic: !ts.italic })} />
        <Segmented
          value={ts.align}
          label={t('text.align')}
          onChange={(align) => set({ align })}
          options={[
            { value: 'left', label: t('text.alignLeft'), icon: AlignLeft, iconOnly: true },
            { value: 'center', label: t('text.alignCenter'), icon: AlignCenter, iconOnly: true },
            { value: 'right', label: t('text.alignRight'), icon: AlignRight, iconOnly: true },
          ]}
        />
      </div>
      <Slider label={t('text.lineHeight')} value={ts.lineHeight} min={0.6} max={3} step={0.05} onChange={(lineHeight) => set({ lineHeight })} />
      <Slider label={t('text.letterSpacing')} value={ts.letterSpacing} min={-20} max={80} unit=" px" onChange={(letterSpacing) => set({ letterSpacing })} />
      <Slider label={t('common.opacity')} value={ts.opacity} min={0.05} max={1} step={0.01} scale={100} unit=" %" onChange={(opacity) => set({ opacity })} />
      <Toggle label={t('text.outline')} checked={ts.outline} onChange={(outline) => set({ outline })} />
      {ts.outline && (
        <>
          <ColorField label={t('common.color')} value={ts.outlineColor} onChange={(outlineColor) => set({ outlineColor })} />
          <Slider label={t('text.outlineWidth')} value={ts.outlineWidth} min={1} max={40} unit=" px" onChange={(outlineWidth) => set({ outlineWidth })} />
        </>
      )}
      <Toggle label={t('text.shadow')} checked={ts.shadow} onChange={(shadow) => set({ shadow })} />
      {ts.shadow && (
        <>
          <ColorField label={t('common.color')} value={ts.shadowColor} onChange={(shadowColor) => set({ shadowColor })} />
          <Slider label={t('text.shadowBlur')} value={ts.shadowBlur} min={0} max={60} unit=" px" onChange={(shadowBlur) => set({ shadowBlur })} />
          <Slider label={t('text.shadowX')} value={ts.shadowX} min={-60} max={60} unit=" px" onChange={(shadowX) => set({ shadowX })} />
          <Slider label={t('text.shadowY')} value={ts.shadowY} min={-60} max={60} unit=" px" onChange={(shadowY) => set({ shadowY })} />
        </>
      )}
      {f && (
        <Button variant="primary" icon={Check} onClick={() => void s.commitFloating()} testId="text-apply">
          {t('text.apply')}
        </Button>
      )}
    </div>
  );
}

export function ToolPanel() {
  const t = useT();
  const tool = useTools((x) => x.tool);
  const sampleAll = useTools((x) => x.eyedropperSampleAll);
  const Icon = TOOL_ICONS[tool];
  let body: React.ReactNode;
  switch (tool) {
    case 'brush':
    case 'pencil':
    case 'pen':
      body = <BrushEditor tool={tool} />;
      break;
    case 'eraser':
      body = <EraserEditor />;
      break;
    case 'shape':
      body = <ShapeEditor />;
      break;
    case 'fill':
      body = <FillEditor />;
      break;
    case 'select':
      body = <SelectEditor />;
      break;
    case 'transform':
      body = <TransformEditor />;
      break;
    case 'text':
      body = <TextEditor />;
      break;
    case 'eyedropper':
      body = (
        <div className="col">
          <Toggle label={t('eyedropper.sampleAll')} checked={sampleAll} onChange={(v) => tools().set({ eyedropperSampleAll: v })} />
          <div className="small muted">{t('eyedropper.hint')}</div>
        </div>
      );
      break;
    case 'hand':
      body = <div className="small muted">{t('hand.hint')}</div>;
      break;
    case 'reference':
      body = <div className="small muted">{t('refs.hint')}</div>;
      break;
  }
  return (
    <div className="panel-section" data-testid="tool-panel">
      <div className="row tool-panel-head">
        <Icon aria-hidden size={20} />
        <strong>{t(`tool.${tool}`)}</strong>
      </div>
      {body}
    </div>
  );
}
