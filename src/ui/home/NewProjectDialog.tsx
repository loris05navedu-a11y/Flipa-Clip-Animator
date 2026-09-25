import { RectangleHorizontal, RectangleVertical } from 'lucide-react';
import { useMemo, useState } from 'react';
import { createProject as makeProject } from '../../core/model/project';
import { celBytes, FPS_CHOICES, MAX_SIZE, MIN_SIZE, SIZE_PRESETS } from '../../core/model/presets';
import { formatBytes } from '../../core/util/math';
import { createProject } from '../../app/store';
import { useT } from '../../i18n';
import { useSettings } from '../../storage/settings';
import { Dialog } from '../components/Dialog';
import { Button, Field, NumberInput, Segmented, SelectInput, Toggle } from '../components/ui';
import { ColorField } from '../components/ColorField';

export interface NewProjectInitial {
  width?: number;
  height?: number;
  fps?: number;
  frames?: number;
  name?: string;
}

export function NewProjectDialog({ onClose, initial, onCreated, projectCount }: { onClose: () => void; initial?: NewProjectInitial; onCreated?: () => void; projectCount: number }) {
  const t = useT();
  const defaultFps = useSettings((s) => s.defaultFps);
  const [name, setName] = useState(initial?.name ?? t('new.defaultName', { n: projectCount + 1 }));
  const [presetId, setPresetId] = useState(initial?.width ? 'custom' : 'hd');
  const [width, setWidth] = useState(initial?.width ?? 1280);
  const [height, setHeight] = useState(initial?.height ?? 720);
  const [fps, setFps] = useState(initial?.fps ?? defaultFps);
  const [frames, setFrames] = useState(initial?.frames ?? 1);
  const [bg, setBg] = useState('#ffffffff');
  const [transparent, setTransparent] = useState(false);

  const orientation = width >= height ? 'landscape' : 'portrait';
  const bytes = celBytes(width, height);
  const duration = useMemo(() => Math.round((frames / fps) * 100) / 100, [frames, fps]);

  const pickPreset = (id: string) => {
    setPresetId(id);
    const p = SIZE_PRESETS.find((x) => x.id === id);
    if (p) {
      setWidth(p.width);
      setHeight(p.height);
      if (p.fps) setFps(p.fps);
    }
  };

  const groups = ['video', 'social', 'square', 'other'] as const;

  const submit = async () => {
    const data = makeProject({ name, width, height, fps, frameCount: frames, background: bg.slice(0, 7), transparent, layerName: `${t('layers.defaultName')} 1` });
    onClose();
    await createProject(data);
    onCreated?.();
  };

  return (
    <Dialog
      title={t('new.title')}
      onClose={onClose}
      size="wide"
      testId="new-project-dialog"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} testId="create-project">
            {t('new.create')}
          </Button>
        </>
      }
    >
      <Field label={t('new.name')}>
        <input className="input" value={name} maxLength={80} data-testid="project-name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      </Field>
      <div className="field">
        <span className="field-label">{t('new.presets')}</span>
        <div className="preset-groups">
          {groups.map((g) => (
            <div key={g} className="preset-group">
              <div className="section-title">{t(`new.group.${g}`)}</div>
              <div className="row wrap">
                {SIZE_PRESETS.filter((p) => p.group === g).map((p) => (
                  <button key={p.id} type="button" className={`chip${presetId === p.id ? ' on' : ''}`} onClick={() => pickPreset(p.id)}>
                    {t(p.label)} <span className="faint small">{p.width}×{p.height}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="row">
            <button type="button" className={`chip${presetId === 'custom' ? ' on' : ''}`} onClick={() => setPresetId('custom')}>
              {t('new.custom')}
            </button>
          </div>
        </div>
      </div>
      <div className="row wrap" style={{ gap: 14, alignItems: 'flex-end' }}>
        <Field label={t('common.width')}>
          <NumberInput label={t('common.width')} value={width} min={MIN_SIZE} max={MAX_SIZE} testId="project-width" onChange={(v) => (setWidth(v), setPresetId('custom'))} />
        </Field>
        <Field label={t('common.height')}>
          <NumberInput label={t('common.height')} value={height} min={MIN_SIZE} max={MAX_SIZE} testId="project-height" onChange={(v) => (setHeight(v), setPresetId('custom'))} />
        </Field>
        <Field label={t('new.orientation')}>
          <Segmented
            value={orientation}
            label={t('new.orientation')}
            onChange={(o) => {
              if (o !== orientation) {
                setWidth(height);
                setHeight(width);
              }
            }}
            options={[
              { value: 'landscape', label: t('new.landscape'), icon: RectangleHorizontal },
              { value: 'portrait', label: t('new.portrait'), icon: RectangleVertical },
            ]}
          />
        </Field>
      </div>
      <div className="row wrap" style={{ gap: 14, alignItems: 'flex-end' }}>
        <Field label={t('new.fps')}>
          <SelectInput label={t('new.fps')} value={fps} testId="project-fps" onChange={setFps} options={FPS_CHOICES.map((f) => ({ value: f, label: `${f} ${t('common.fps')}` }))} />
        </Field>
        <Field label={t('new.frames')}>
          <NumberInput label={t('new.frames')} value={frames} min={1} max={5000} testId="project-frames" onChange={setFrames} />
        </Field>
        <Field label={`${t('new.duration')} (${t('common.seconds')})`}>
          <NumberInput label={t('new.duration')} value={duration} min={1 / fps} max={600} step={0.01} onChange={(d) => setFrames(Math.max(1, Math.round(d * fps)))} />
        </Field>
      </div>
      <div className="row wrap" style={{ gap: 14 }}>
        <ColorField label={t('new.background')} value={bg} onChange={setBg} disabled={transparent} />
        <div style={{ minWidth: 240 }}>
          <Toggle label={t('new.transparent')} checked={transparent} onChange={setTransparent} testId="project-transparent" />
        </div>
      </div>
      <div className="small muted">
        {t('new.memory', { size: formatBytes(bytes) })}
        {width * height > 2560 * 1440 && <div style={{ color: 'var(--warning)', marginTop: 4 }}>{t('new.largeWarning')}</div>}
      </div>
    </Dialog>
  );
}
