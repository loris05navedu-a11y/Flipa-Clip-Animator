import { Eye, EyeOff, ImagePlus, Lock, LockOpen, Maximize, Move, Trash2 } from 'lucide-react';
import { useT } from '../../i18n';
import { tools, useTools } from '../../editor/toolStore';
import { pickFiles } from '../../platform/platform';
import { IconButton, Segmented, Slider, Toggle, Button } from '../components/ui';
import { useCtrl, useSession } from './context';
import { importReference } from './importActions';

export function RefsPanel() {
  const t = useT();
  const ctrl = useCtrl();
  const s = useSession();
  const selected = useTools((x) => x.referenceId);
  const refs = s.doc.references;
  return (
    <div className="panel-section" data-testid="refs-panel">
      <Button icon={ImagePlus} onClick={async () => { const [f] = await pickFiles('image/*'); if (f) await importReference(ctrl, f); }} testId="add-reference">
        {t('refs.add')}
      </Button>
      <Toggle label={t('refs.allVisible')} checked={s.doc.view.referencesVisible} onChange={(referencesVisible) => s.updateView({ referencesVisible })} />
      <div className="small muted">{t('refs.hint')}</div>
      {!refs.length && <div className="empty-state">{t('refs.empty')}</div>}
      {[...refs].reverse().map((r) => {
        const on = r.id === selected;
        return (
          <div key={r.id} className={`ref-item${on ? ' on' : ''}`} onClick={() => tools().set({ referenceId: r.id })}>
            <div className="row">
              <strong className="grow ellipsis">{r.name}</strong>
              <IconButton icon={r.visible ? Eye : EyeOff} small label={t('refs.visible')} onClick={(e) => (e.stopPropagation(), s.updateReference(r.id, { visible: !r.visible }))} />
              <IconButton icon={r.locked ? Lock : LockOpen} small toggled={r.locked} label={t('refs.lock')} onClick={(e) => (e.stopPropagation(), s.updateReference(r.id, { locked: !r.locked }))} />
              <IconButton icon={Move} small label={t('refs.edit')} onClick={(e) => (e.stopPropagation(), tools().set({ referenceId: r.id }), ctrl.setTool('reference'))} />
              <IconButton icon={Trash2} small danger label={t('refs.delete')} onClick={(e) => (e.stopPropagation(), s.removeReference(r.id))} />
            </div>
            {on && (
              <div className="col" onClick={(e) => e.stopPropagation()}>
                <Slider label={t('refs.opacity')} value={r.opacity} min={0.02} max={1} step={0.01} scale={100} unit=" %" onChange={(opacity) => s.updateReference(r.id, { opacity }, 'opacity')} />
                <Slider label={t('refs.scale')} value={r.scale} min={0.02} max={8} step={0.01} scale={100} unit=" %" onChange={(scale) => s.updateReference(r.id, { scale }, 'scale')} />
                <Slider label={t('refs.rotation')} value={(r.rotation * 180) / Math.PI} min={-180} max={180} unit="°" onChange={(d) => s.updateReference(r.id, { rotation: (d * Math.PI) / 180 }, 'rotation')} />
                <Segmented value={r.placement} full label="placement" onChange={(placement) => s.updateReference(r.id, { placement })} options={[{ value: 'below', label: t('refs.placementBelow') }, { value: 'above', label: t('refs.placementAbove') }]} />
                <Toggle label={t('refs.exportable')} checked={r.exportable} onChange={(exportable) => s.updateReference(r.id, { exportable })} />
                <Button
                  small
                  icon={Maximize}
                  onClick={() => s.updateReference(r.id, { x: s.doc.width / 2, y: s.doc.height / 2, rotation: 0, scale: Math.min(s.doc.width / r.naturalWidth, s.doc.height / r.naturalHeight) })}
                >
                  {t('refs.fit')}
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
