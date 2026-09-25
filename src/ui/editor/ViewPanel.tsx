import { Plus, Trash2, Crosshair } from 'lucide-react';
import { uid } from '../../core/util/id';
import type { SymmetryMode } from '../../core/model/types';
import { useT } from '../../i18n';
import { ColorField } from '../components/ColorField';
import { IconButton, NumberInput, Segmented, SelectInput, Slider, Toggle } from '../components/ui';
import { useSession } from './context';

export function ViewPanel() {
  const t = useT();
  const s = useSession();
  const v = s.doc.view;
  const o = v.onion;
  const g = v.grid;
  const sym = v.symmetry;
  const setOnion = (p: Partial<typeof o>) => s.updateView({ onion: { ...o, ...p } });
  const setGrid = (p: Partial<typeof g>) => s.updateView({ grid: { ...g, ...p } });
  const setSym = (p: Partial<typeof sym>) => s.updateView({ symmetry: { ...sym, ...p } });

  return (
    <div className="panel-section view-panel" data-testid="view-panel">
      <div className="section-title">{t('onion.title')}</div>
      <Toggle label={t('onion.enabled')} checked={o.enabled} onChange={(enabled) => setOnion({ enabled })} testId="onion-enabled" />
      <div className="grid-2">
        <div className="field">
          <label>{t('onion.before')}</label>
          <NumberInput label={t('onion.before')} value={o.before} min={0} max={10} onChange={(before) => setOnion({ before })} testId="onion-before" />
        </div>
        <div className="field">
          <label>{t('onion.after')}</label>
          <NumberInput label={t('onion.after')} value={o.after} min={0} max={10} onChange={(after) => setOnion({ after })} testId="onion-after" />
        </div>
      </div>
      <Slider label={t('onion.opacity')} value={o.opacity} min={0.02} max={1} step={0.01} scale={100} unit=" %" onChange={(opacity) => setOnion({ opacity })} />
      <Slider label={t('onion.falloff')} value={o.falloff} min={0.1} max={1} step={0.01} scale={100} unit=" %" onChange={(falloff) => setOnion({ falloff })} />
      <Toggle label={t('onion.tint')} checked={o.tint} onChange={(tint) => setOnion({ tint })} />
      {o.tint && (
        <div className="row wrap">
          <ColorField label={t('onion.colorBefore')} value={o.colorBefore} alpha={false} onChange={(c) => setOnion({ colorBefore: c.slice(0, 7) })} />
          <ColorField label={t('onion.colorAfter')} value={o.colorAfter} alpha={false} onChange={(c) => setOnion({ colorAfter: c.slice(0, 7) })} />
        </div>
      )}
      <Segmented value={o.allLayers ? 'all' : 'active'} full label="layers" onChange={(x) => setOnion({ allLayers: x === 'all' })} options={[{ value: 'all', label: t('onion.allLayers') }, { value: 'active', label: t('onion.activeLayer') }]} />
      <Toggle label={t('onion.loop')} checked={o.loop} onChange={(loop) => setOnion({ loop })} />

      <div className="section-title">{t('view.grid')}</div>
      <Toggle label={t('view.grid')} checked={g.enabled} onChange={(enabled) => setGrid({ enabled })} testId="grid-enabled" />
      <Slider label={t('view.gridSize')} value={g.size} min={2} max={512} unit=" px" onChange={(size) => setGrid({ size })} />
      <Slider label={t('view.gridOpacity')} value={g.opacity} min={0.05} max={1} step={0.01} scale={100} unit=" %" onChange={(opacity) => setGrid({ opacity })} />
      <ColorField label={t('view.gridColor')} value={g.color} alpha={false} onChange={(c) => setGrid({ color: c.slice(0, 7) })} />
      <Toggle label={t('view.snapGrid')} checked={g.snap} onChange={(snap) => setGrid({ snap })} />

      <div className="section-title">{t('view.guides')}</div>
      <Toggle label={t('view.rulers')} checked={v.rulers} onChange={(rulers) => s.updateView({ rulers })} testId="rulers-enabled" />
      <Toggle label={t('view.guidesVisible')} checked={v.guidesVisible} onChange={(guidesVisible) => s.updateView({ guidesVisible })} />
      <Toggle label={t('view.snapGuides')} checked={v.snapGuides} onChange={(snapGuides) => s.updateView({ snapGuides })} />
      <div className="row wrap">
        <button type="button" className="btn small" data-testid="add-vguide" onClick={() => s.updateView({ guides: [...v.guides, { id: uid('g'), axis: 'x', pos: Math.round(s.doc.width / 2) }], guidesVisible: true })}>
          <Plus size={14} aria-hidden /> {t('view.addVGuide')}
        </button>
        <button type="button" className="btn small" onClick={() => s.updateView({ guides: [...v.guides, { id: uid('g'), axis: 'y', pos: Math.round(s.doc.height / 2) }], guidesVisible: true })}>
          <Plus size={14} aria-hidden /> {t('view.addHGuide')}
        </button>
      </div>
      {v.guides.map((gd) => (
        <div key={gd.id} className="row">
          <span className="grow small">{gd.axis === 'x' ? t('view.guideVertical') : t('view.guideHorizontal')}</span>
          <NumberInput label={gd.axis} value={gd.pos} onChange={(pos) => s.updateView({ guides: v.guides.map((x) => (x.id === gd.id ? { ...x, pos } : x)) })} />
          <IconButton icon={Trash2} small danger label={t('common.delete')} onClick={() => s.updateView({ guides: v.guides.filter((x) => x.id !== gd.id) })} />
        </div>
      ))}
      {v.guides.length > 0 && (
        <button type="button" className="btn small ghost" onClick={() => s.updateView({ guides: [] })}>
          {t('view.clearGuides')}
        </button>
      )}
      <div className="small muted">{t('view.guidesHint')}</div>

      <div className="section-title">{t('view.symmetry')}</div>
      <SelectInput<SymmetryMode>
        label={t('view.symmetry')}
        value={sym.mode}
        testId="symmetry-mode"
        onChange={(mode) => setSym({ mode })}
        options={[
          { value: 'off', label: t('view.symOff') },
          { value: 'vertical', label: t('view.symVertical') },
          { value: 'horizontal', label: t('view.symHorizontal') },
          { value: 'quad', label: t('view.symQuad') },
          { value: 'radial', label: t('view.symRadial') },
        ]}
      />
      {sym.mode === 'radial' && (
        <>
          <Slider label={t('view.symSegments')} value={sym.segments} min={2} max={32} onChange={(segments) => setSym({ segments })} />
          <Toggle label={t('view.symMirror')} checked={sym.mirror} onChange={(mirror) => setSym({ mirror })} />
        </>
      )}
      {sym.mode !== 'off' && (
        <>
          <Toggle label={t('view.symVisible')} checked={sym.visible} onChange={(visible) => setSym({ visible })} />
          <div className="row">
            <NumberInput label="x" value={Math.round(sym.cx)} min={0} max={s.doc.width} onChange={(cx) => setSym({ cx })} />
            <NumberInput label="y" value={Math.round(sym.cy)} min={0} max={s.doc.height} onChange={(cy) => setSym({ cy })} />
            <IconButton icon={Crosshair} small label={t('view.symCenter')} onClick={() => setSym({ cx: s.doc.width / 2, cy: s.doc.height / 2 })} />
          </div>
          <div className="small muted">{t('view.symHint')}</div>
        </>
      )}
    </div>
  );
}
