import { ArrowLeftRight, Pencil, Pipette, Plus, Trash2, Check } from 'lucide-react';
import { useState } from 'react';
import { uid } from '../../core/util/id';
import type { Palette } from '../../core/model/types';
import { useT } from '../../i18n';
import { tools, useTools } from '../../editor/toolStore';
import { dialogs } from '../components/dialogs';
import { ColorPicker } from '../components/ColorPicker';
import { IconButton, SelectInput, Swatch, toCssColor } from '../components/ui';
import { useCtrl, useSession } from './context';

export function ColorPanel() {
  const t = useT();
  const ctrl = useCtrl();
  const s = useSession();
  const primary = useTools((x) => x.primary);
  const secondary = useTools((x) => x.secondary);
  const recent = useTools((x) => x.recent);
  const palettes = useTools((x) => x.palettes);
  const activePalette = useTools((x) => x.activePalette);
  const [slot, setSlot] = useState<'primary' | 'secondary'>('primary');
  const [editing, setEditing] = useState(false);
  const value = slot === 'primary' ? primary : secondary;

  const projectPal = s.doc.palettes;
  const isProject = activePalette.startsWith('project:');
  const current: Palette | undefined = isProject ? projectPal.find((p) => 'project:' + p.id === activePalette) : palettes.find((p) => p.id === activePalette);

  const updatePalette = (colors: string[]) => {
    if (!current) return;
    if (isProject) s.change('history.palette', { palettes: projectPal.map((p) => (p.id === current.id ? { ...p, colors } : p)) });
    else tools().updatePalette(current.id, { colors });
  };
  const addColor = () => current && !current.colors.includes(value) && updatePalette([...current.colors, value]);
  const newPalette = async (project: boolean) => {
    const name = await dialogs.prompt(t('color.newPalette'), t('common.name'), t('color.newPaletteName'));
    if (!name) return;
    if (project) {
      const p: Palette = { id: uid('pal'), name, colors: [] };
      s.change('history.palette', { palettes: [...projectPal, p] });
      tools().set({ activePalette: 'project:' + p.id });
    } else tools().addPalette(name);
  };
  const renamePalette = async () => {
    if (!current) return;
    const name = await dialogs.prompt(t('color.renamePalette'), t('common.name'), current.name);
    if (!name) return;
    if (isProject) s.change('history.palette', { palettes: projectPal.map((p) => (p.id === current.id ? { ...p, name } : p)) });
    else tools().updatePalette(current.id, { name });
  };
  const deletePalette = async () => {
    if (!current) return;
    if (!(await dialogs.confirm(t('color.deletePalette'), t('color.deletePaletteConfirm', { name: current.name }), t('common.delete'), true))) return;
    if (isProject) {
      s.change('history.palette', { palettes: projectPal.filter((p) => p.id !== current.id) });
      tools().set({ activePalette: palettes[0]?.id ?? '' });
    } else tools().deletePalette(current.id);
  };
  const pick = (hex: string) => {
    ctrl.setColor(hex, slot);
    tools().pushRecent(hex);
  };

  return (
    <div className="panel-section color-panel" data-testid="color-panel">
      <div className="row">
        <button type="button" className={`slot${slot === 'primary' ? ' on' : ''}`} onClick={() => setSlot('primary')} aria-pressed={slot === 'primary'}>
          <span className="slot-swatch" style={{ background: toCssColor(primary) }} />
          {t('color.primary')}
        </button>
        <button type="button" className={`slot${slot === 'secondary' ? ' on' : ''}`} onClick={() => setSlot('secondary')} aria-pressed={slot === 'secondary'}>
          <span className="slot-swatch" style={{ background: toCssColor(secondary) }} />
          {t('color.secondary')}
        </button>
        <IconButton icon={ArrowLeftRight} small label={t('color.swap')} onClick={() => tools().swapColors()} />
        <IconButton icon={Pipette} small label={t('color.eyedropper')} onClick={() => ctrl.setTool('eyedropper')} />
      </div>
      <ColorPicker value={value} onChange={(h) => ctrl.setColor(h, slot)} onCommit={(h) => tools().pushRecent(h)} />
      {recent.length > 0 && (
        <>
          <div className="section-title">{t('color.recent')}</div>
          <div className="swatch-grid">
            {recent.map((c) => (
              <Swatch key={c} color={c} label={c} onClick={() => pick(c)} />
            ))}
          </div>
        </>
      )}
      <div className="section-title">{t('color.palettes')}</div>
      <div className="row">
        <div className="grow">
          <SelectInput
            label={t('color.palettes')}
            value={activePalette}
            onChange={(v) => tools().set({ activePalette: v })}
            options={[
              ...palettes.map((p) => ({ value: p.id, label: `${p.name}` })),
              ...projectPal.map((p) => ({ value: 'project:' + p.id, label: `${p.name} (${t('color.projectPalettes').toLowerCase()})` })),
            ]}
          />
        </div>
        <IconButton icon={Pencil} small label={t('color.renamePalette')} disabled={!current} onClick={() => void renamePalette()} />
        <IconButton icon={Trash2} small danger label={t('color.deletePalette')} disabled={!current} onClick={() => void deletePalette()} />
      </div>
      {current && (
        <div className="swatch-grid" data-testid="palette-swatches">
          {current.colors.map((c, i) => (
            <Swatch
              key={c + i}
              color={c}
              label={editing ? `${t('common.remove')} ${c}` : c}
              selected={!editing && c === value}
              onClick={() => (editing ? updatePalette(current.colors.filter((_, j) => j !== i)) : pick(c))}
            />
          ))}
          <button type="button" className="swatch add-swatch" aria-label={t('color.addToPalette')} title={t('color.addToPalette')} onClick={addColor} data-testid="add-to-palette">
            <Plus size={16} aria-hidden />
          </button>
        </div>
      )}
      <div className="row wrap">
        <button type="button" className="btn small" onClick={() => setEditing(!editing)}>
          {editing ? (
            <>
              <Check size={14} aria-hidden /> {t('color.doneEditing')}
            </>
          ) : (
            t('color.editPalette')
          )}
        </button>
        <button type="button" className="btn small" onClick={() => void newPalette(false)}>
          <Plus size={14} aria-hidden /> {t('color.newPalette')}
        </button>
        <button type="button" className="btn small" onClick={() => void newPalette(true)}>
          <Plus size={14} aria-hidden /> {t('color.newProjectPalette')}
        </button>
      </div>
    </div>
  );
}
