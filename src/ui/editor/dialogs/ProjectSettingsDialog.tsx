import { useState } from 'react';
import { FPS_CHOICES, MAX_FPS, MIN_FPS } from '../../../core/model/presets';
import { formatBytes, formatTime } from '../../../core/util/math';
import { setUi } from '../../../editor/controller';
import { useT } from '../../../i18n';
import { ColorField } from '../../components/ColorField';
import { Dialog } from '../../components/Dialog';
import { Button, Field, NumberInput, Toggle } from '../../components/ui';
import { useSession } from '../context';

export default function ProjectSettingsDialog() {
  const t = useT();
  const s = useSession();
  const [name, setName] = useState(s.doc.name);
  const close = () => setUi({ dialog: null });
  const st = s.stats();
  return (
    <Dialog
      title={t('ps.title')}
      onClose={close}
      testId="project-settings"
      footer={
        <Button variant="primary" onClick={() => { if (name.trim() && name !== s.doc.name) s.updateProject({ name: name.trim().slice(0, 120) }); close(); }} testId="ps-ok">
          {t('common.ok')}
        </Button>
      }
    >
      <Field label={t('ps.name')}>
        <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} data-testid="ps-name" />
      </Field>
      <div className="row wrap" style={{ gap: 16, alignItems: 'flex-end' }}>
        <Field label={t('ps.fps')}>
          <NumberInput label={t('ps.fps')} value={s.doc.fps} min={MIN_FPS} max={MAX_FPS} onChange={(fps) => s.updateProject({ fps })} />
        </Field>
        <div className="row wrap">
          {FPS_CHOICES.map((f) => (
            <button key={f} type="button" className={`chip${s.doc.fps === f ? ' on' : ''}`} onClick={() => s.updateProject({ fps: f })}>
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className="row wrap" style={{ gap: 16 }}>
        <ColorField label={t('ps.background')} value={s.doc.background.color} alpha={false} disabled={s.doc.background.transparent} onChange={(c) => s.updateProject({ background: { ...s.doc.background, color: c.slice(0, 7) } }, 'bg')} />
        <div style={{ minWidth: 220 }}>
          <Toggle label={t('ps.transparent')} checked={s.doc.background.transparent} onChange={(v) => s.updateProject({ background: { ...s.doc.background, transparent: v } })} />
        </div>
      </div>
      <div className="row">
        <span className="grow">
          {t('ps.size')} : <strong>{s.doc.width} × {s.doc.height}</strong>
        </span>
        <Button small onClick={() => setUi({ dialog: 'resize' })}>
          {t('ps.resize')}
        </Button>
      </div>
      <div className="section-title">{t('ps.stats')}</div>
      <div className="small muted">
        {t('editor.stats', { frames: st.frames, layers: st.layers, duration: formatTime(st.duration) })}
        <br />
        {t('ps.memory', { size: formatBytes(st.memory) })}
        <br />
        {t('ps.historyMem', { size: formatBytes(st.history) })}
      </div>
    </Dialog>
  );
}
