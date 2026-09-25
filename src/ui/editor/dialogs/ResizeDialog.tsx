import { useState } from 'react';
import { MAX_SIZE, MIN_SIZE } from '../../../core/model/presets';
import { setUi } from '../../../editor/controller';
import { useT } from '../../../i18n';
import { showError } from '../../../app/store';
import { dialogs } from '../../components/dialogs';
import { Dialog } from '../../components/Dialog';
import { Button, Field, NumberInput, Segmented, Toggle } from '../../components/ui';
import { useCtrl, useSession } from '../context';

const ANCHORS = [0, 0.5, 1];

export default function ResizeDialog() {
  const t = useT();
  const ctrl = useCtrl();
  const s = useSession();
  const [w, setW] = useState(s.doc.width);
  const [h, setH] = useState(s.doc.height);
  const [lock, setLock] = useState(true);
  const [mode, setMode] = useState<'scale' | 'anchor'>('scale');
  const [anchor, setAnchor] = useState({ x: 0.5, y: 0.5 });
  const ratio = s.doc.width / s.doc.height;
  const close = () => setUi({ dialog: null });
  const apply = async () => {
    if (w === s.doc.width && h === s.doc.height) return close();
    if (!(await dialogs.confirm(t('ps.resizeTitle'), t('ps.resizeWarning'), t('common.apply')))) return;
    close();
    setUi({ busy: t('ps.resizing', { p: 0 }), progress: 0 });
    try {
      await s.resizeCanvas(w, h, mode, anchor, (p) => setUi({ progress: p, busy: t('ps.resizing', { p: Math.round(p * 100) }) }));
      ctrl.viewport?.syncDocSize();
      ctrl.fit();
    } catch (e) {
      await showError(e, 'error.generic');
    } finally {
      setUi({ busy: null, progress: null });
    }
  };
  return (
    <Dialog
      title={t('ps.resizeTitle')}
      onClose={close}
      size="narrow"
      footer={
        <>
          <Button onClick={close}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={() => void apply()}>
            {t('common.apply')}
          </Button>
        </>
      }
    >
      <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
        <Field label={t('common.width')}>
          <NumberInput label={t('common.width')} value={w} min={MIN_SIZE} max={MAX_SIZE} onChange={(v) => { setW(v); if (lock) setH(Math.max(MIN_SIZE, Math.round(v / ratio))); }} />
        </Field>
        <Field label={t('common.height')}>
          <NumberInput label={t('common.height')} value={h} min={MIN_SIZE} max={MAX_SIZE} onChange={(v) => { setH(v); if (lock) setW(Math.max(MIN_SIZE, Math.round(v * ratio))); }} />
        </Field>
      </div>
      <Toggle label={t('ps.lockRatio')} checked={lock} onChange={setLock} />
      <Segmented value={mode} full label={t('ps.resizeMode')} onChange={setMode} options={[{ value: 'scale', label: t('ps.resizeScale') }, { value: 'anchor', label: t('ps.resizeAnchor') }]} />
      {mode === 'anchor' && (
        <div className="field">
          <label>{t('ps.anchor')}</label>
          <div className="anchor-grid">
            {ANCHORS.map((y) =>
              ANCHORS.map((x) => (
                <button key={`${x}-${y}`} type="button" aria-label={`${x},${y}`} className={anchor.x === x && anchor.y === y ? 'on' : ''} onClick={() => setAnchor({ x, y })} />
              )),
            )}
          </div>
        </div>
      )}
      <div className="small muted">{t('ps.resizeWarning')}</div>
    </Dialog>
  );
}
