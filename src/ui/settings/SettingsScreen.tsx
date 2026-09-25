import { ArrowLeft, Brush, Clapperboard, Download, HardDrive, Info, Keyboard, LayoutPanelLeft, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Zip, ZipPassThrough } from 'fflate';
import { useApp } from '../../app/store';
import { getRepo, requestPersistence, storageEstimate } from '../../app/services';
import { FPS_CHOICES } from '../../core/model/presets';
import { formatBytes } from '../../core/util/math';
import { writeProjectFile } from '../../core/format/projectFile';
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, comboFromEvent, formatCombo, shortcutMap } from '../../editor/shortcuts';
import { useT } from '../../i18n';
import { clearExportCache, saveFile } from '../../platform/platform';
import { useSettings, type GestureAction } from '../../storage/settings';
import { pushBack } from '../components/back';
import { dialogs } from '../components/dialogs';
import { toast } from '../components/toast';
import { Button, IconButton, SelectInput, Slider, Toggle } from '../components/ui';
import { Logo } from '../components/Logo';

const SECTIONS = [
  { id: 'general', icon: Settings },
  { id: 'drawing', icon: Brush },
  { id: 'animation', icon: Clapperboard },
  { id: 'interface', icon: LayoutPanelLeft },
  { id: 'export', icon: Download },
  { id: 'storage', icon: HardDrive },
  { id: 'shortcuts', icon: Keyboard },
  { id: 'about', icon: Info },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="settings-row">
      <div className="grow">
        <div className="settings-label">{label}</div>
        {hint && <div className="small muted">{hint}</div>}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  );
}

function ShortcutEditor() {
  const t = useT();
  const custom = useSettings((s) => s.shortcuts);
  const set = useSettings((s) => s.set);
  const [capturing, setCapturing] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const map = { ...DEFAULT_SHORTCUTS, ...custom };
  useEffect(() => {
    if (!capturing) return;
    const on = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setCapturing(null);
      const combo = comboFromEvent(e);
      if (!combo) return;
      const owner = Object.entries(shortcutMap()).find(([a, c]) => a !== capturing && c.includes(combo));
      if (owner) {
        setConflict(t('settings.shortcutConflict', { action: t(`action.${owner[0]}`) }));
        return;
      }
      set({ shortcuts: { ...custom, [capturing]: [combo] } });
      setConflict(null);
      setCapturing(null);
    };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, [capturing, custom, set, t]);
  return (
    <div className="col">
      <div className="small muted">{t('settings.shortcutsHint')}</div>
      {conflict && <div className="small" style={{ color: 'var(--danger)' }}>{conflict}</div>}
      <div className="shortcut-list">
        {SHORTCUT_ACTIONS.map((a) => (
          <div key={a} className="shortcut-row">
            <span className="grow">{t(`action.${a}`)}</span>
            <button type="button" className={`btn small${capturing === a ? ' primary' : ''}`} onClick={() => setCapturing(capturing === a ? null : a)}>
              {capturing === a ? t('settings.shortcutPress') : map[a].map(formatCombo).join(' / ') || '—'}
            </button>
          </div>
        ))}
      </div>
      <Button onClick={() => set({ shortcuts: {} })}>{t('settings.shortcutsReset')}</Button>
    </div>
  );
}

function StorageSection() {
  const t = useT();
  const s = useSettings();
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  const refresh = () => void storageEstimate().then(setEst);
  useEffect(refresh, []);
  return (
    <>
      <Row label={t('settings.location')} hint={t('settings.locationValue')}>
        <span />
      </Row>
      {est && <div className="small muted">{t('settings.usage', { used: formatBytes(est.usage), quota: formatBytes(est.quota) })}</div>}
      <Row label={t('settings.keepVersions')}>
        <SelectInput label={t('settings.keepVersions')} value={s.keepVersions} onChange={(keepVersions) => s.set({ keepVersions })} options={[1, 3, 5, 10, 20, 50].map((n) => ({ value: n, label: String(n) }))} />
      </Row>
      <Row label={t('settings.cache')} hint={t('settings.cacheHint')}>
        <SelectInput label={t('settings.cache')} value={s.cacheBudgetMB} onChange={(cacheBudgetMB) => s.set({ cacheBudgetMB })} options={[128, 192, 256, 384, 512, 768, 1024].map((n) => ({ value: n, label: `${n} Mo` }))} />
      </Row>
      <div className="row wrap">
        <Button
          onClick={async () => {
            const repo = await getRepo();
            let n = await clearExportCache();
            for (const m of [...(await repo.list()), ...(await repo.listTrash())]) n += await repo.gc(m.id);
            toast('settings.clearCacheDone', 'success', { n });
            refresh();
          }}
        >
          {t('settings.clearCache')}
        </Button>
        <Button onClick={async () => toast((await requestPersistence()) ? 'settings.persistOk' : 'settings.persistNo')}>{t('settings.persist')}</Button>
        <Button
          onClick={async () => {
            const repo = await getRepo();
            const chunks: Uint8Array[] = [];
            let done: () => void = () => undefined;
            const finished = new Promise<void>((r) => (done = r));
            const zip = new Zip((err, data, final) => {
              if (!err) chunks.push(data);
              if (final || err) done();
            });
            for (const m of await repo.list()) {
              const { doc } = await repo.load(m.id);
              const blob = await writeProjectFile(doc, (k) => repo.getAsset(m.id, k));
              const f = new ZipPassThrough(`${m.name.replace(/[\\/:*?"<>|]/g, '_')}_${m.id}.frameloom`);
              zip.add(f);
              f.push(new Uint8Array(await blob.arrayBuffer()), true);
            }
            zip.end();
            await finished;
            if (await saveFile(new Blob(chunks as BlobPart[], { type: 'application/zip' }), `frameloom-backup-${new Date().toISOString().slice(0, 10)}.zip`, 'application/zip')) toast('settings.backupDone', 'success');
          }}
        >
          {t('settings.backupAll')}
        </Button>
      </div>
    </>
  );
}

export default function SettingsScreen() {
  const t = useT();
  const s = useSettings();
  const back = useApp((a) => a.previous);
  const go = useApp((a) => a.go);
  const [section, setSection] = useState<SectionId>('general');
  useEffect(() => pushBack(() => (go(back), true)), [go, back]);
  const gestures: { value: GestureAction; label: string }[] = [
    { value: 'undo', label: t('gesture.undo') },
    { value: 'redo', label: t('gesture.redo') },
    { value: 'toggleUi', label: t('gesture.toggleUi') },
    { value: 'fit', label: t('gesture.fit') },
    { value: 'none', label: t('gesture.none') },
  ];

  return (
    <div className="settings-screen" data-testid="settings">
      <header className="home-header">
        <div className="row">
          <IconButton icon={ArrowLeft} label={t('common.back')} onClick={() => go(back)} testId="settings-back" />
          <h1 style={{ fontSize: 20 }}>{t('settings.title')}</h1>
        </div>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t('settings.title')}>
          {SECTIONS.map((x) => (
            <button key={x.id} type="button" className={`settings-nav-item${section === x.id ? ' on' : ''}`} onClick={() => setSection(x.id)} data-testid={`settings-${x.id}`}>
              <x.icon size={18} aria-hidden />
              {t(`settings.${x.id}`)}
            </button>
          ))}
        </nav>
        <main className="settings-body scroll">
          <h2>{t(`settings.${section}`)}</h2>
          {section === 'general' && (
            <>
              <Row label={t('settings.language')}>
                <SelectInput label={t('settings.language')} value={s.language} testId="setting-language" onChange={(language) => s.set({ language })} options={[{ value: 'auto', label: t('settings.langAuto') }, { value: 'fr', label: 'Français' }, { value: 'en', label: 'English' }]} />
              </Row>
              <Row label={t('settings.theme')}>
                <SelectInput label={t('settings.theme')} value={s.theme} testId="setting-theme" onChange={(theme) => s.set({ theme })} options={[{ value: 'system', label: t('settings.themeSystem') }, { value: 'light', label: t('settings.themeLight') }, { value: 'dark', label: t('settings.themeDark') }]} />
              </Row>
              <Row label={t('settings.autosave')} hint={t('settings.autosaveHint')}>
                <SelectInput label={t('settings.autosave')} value={s.autosaveInterval} onChange={(autosaveInterval) => s.set({ autosaveInterval })} options={[{ value: 30, label: t('settings.autosave30') }, { value: 60, label: t('settings.autosave60') }, { value: 300, label: t('settings.autosave300') }, { value: 0, label: t('settings.autosaveOff') }]} />
              </Row>
              <Row label={t('settings.startup')}>
                <SelectInput label={t('settings.startup')} value={s.startup} onChange={(startup) => s.set({ startup })} options={[{ value: 'home', label: t('settings.startupHome') }, { value: 'lastProject', label: t('settings.startupLast') }]} />
              </Row>
            </>
          )}
          {section === 'drawing' && (
            <>
              <Slider label={t('settings.brushSize')} value={s.defaultBrushSize} min={1} max={200} unit=" px" onChange={(defaultBrushSize) => s.set({ defaultBrushSize })} />
              <Slider label={t('settings.smoothing')} value={s.smoothing} min={0} max={2} step={0.05} scale={100} unit=" %" onChange={(smoothing) => s.set({ smoothing })} />
              <Slider label={t('settings.stabilization')} value={s.stabilization} min={0} max={1} step={0.01} scale={100} unit=" %" onChange={(stabilization) => s.set({ stabilization })} />
              <Toggle label={t('settings.pressure')} checked={s.pressure} onChange={(pressure) => s.set({ pressure })} />
              <div className="small muted">{t('settings.pressureHint')}</div>
              <Toggle label={t('settings.stylusOnly')} checked={s.stylusOnly} onChange={(stylusOnly) => s.set({ stylusOnly })} />
              <Toggle label={t('settings.recordToolChanges')} checked={s.recordToolChanges} onChange={(recordToolChanges) => s.set({ recordToolChanges })} />
              <Row label={t('settings.historySteps')}>
                <SelectInput label={t('settings.historySteps')} value={s.historySteps} onChange={(historySteps) => s.set({ historySteps })} options={[30, 50, 100, 200, 400].map((n) => ({ value: n, label: String(n) }))} />
              </Row>
            </>
          )}
          {section === 'animation' && (
            <>
              <Row label={t('settings.defaultFps')}>
                <SelectInput label={t('settings.defaultFps')} value={s.defaultFps} onChange={(defaultFps) => s.set({ defaultFps })} options={FPS_CHOICES.map((f) => ({ value: f, label: String(f) }))} />
              </Row>
              <Toggle label={t('settings.onionDefault')} checked={s.onionDefault} onChange={(onionDefault) => s.set({ onionDefault })} />
              <Slider label={t('settings.onionBefore')} value={s.onionBefore} min={0} max={10} onChange={(onionBefore) => s.set({ onionBefore })} />
              <Slider label={t('settings.onionAfter')} value={s.onionAfter} min={0} max={10} onChange={(onionAfter) => s.set({ onionAfter })} />
              <Toggle label={t('settings.autoPlay')} checked={s.autoPlayPreview} onChange={(autoPlayPreview) => s.set({ autoPlayPreview })} />
              <Toggle label={t('settings.loopPlayback')} checked={s.loopPlayback} onChange={(loopPlayback) => s.set({ loopPlayback })} />
            </>
          )}
          {section === 'interface' && (
            <>
              <Row label={t('settings.uiSize')}>
                <SelectInput label={t('settings.uiSize')} value={s.uiSize} testId="setting-uisize" onChange={(uiSize) => s.set({ uiSize })} options={[{ value: 'compact', label: t('settings.uiCompact') }, { value: 'normal', label: t('settings.uiNormal') }, { value: 'large', label: t('settings.uiLarge') }]} />
              </Row>
              <Row label={t('settings.handedness')}>
                <SelectInput label={t('settings.handedness')} value={s.handedness} onChange={(handedness) => s.set({ handedness })} options={[{ value: 'right', label: t('settings.rightHanded') }, { value: 'left', label: t('settings.leftHanded') }]} />
              </Row>
              <Toggle label={t('settings.timelineVisible')} checked={s.timelineVisible} onChange={(timelineVisible) => s.set({ timelineVisible })} />
              <Toggle label={t('settings.compact')} checked={s.compact} onChange={(compact) => s.set({ compact })} />
              <Toggle label={t('settings.tooltips')} checked={s.tooltips} onChange={(tooltips) => s.set({ tooltips })} />
              <Toggle label={t('settings.reduceMotion')} checked={s.reduceMotion} onChange={(reduceMotion) => s.set({ reduceMotion })} />
              <h3>{t('settings.gestures')}</h3>
              <Row label={t('settings.twoFinger')}>
                <SelectInput label={t('settings.twoFinger')} value={s.twoFingerTap} onChange={(twoFingerTap) => s.set({ twoFingerTap })} options={gestures} />
              </Row>
              <Row label={t('settings.threeFinger')}>
                <SelectInput label={t('settings.threeFinger')} value={s.threeFingerTap} onChange={(threeFingerTap) => s.set({ threeFingerTap })} options={gestures} />
              </Row>
              <Toggle label={t('settings.gestureRotate')} checked={s.gestureRotate} onChange={(gestureRotate) => s.set({ gestureRotate })} />
            </>
          )}
          {section === 'export' && (
            <>
              <Row label={t('settings.exportQuality')}>
                <SelectInput label={t('settings.exportQuality')} value={s.exportQuality} onChange={(exportQuality) => s.set({ exportQuality })} options={[{ value: 'low', label: t('export.qualityLow') }, { value: 'medium', label: t('export.qualityMedium') }, { value: 'high', label: t('export.qualityHigh') }]} />
              </Row>
              <Row label={t('settings.exportScale')}>
                <SelectInput label={t('settings.exportScale')} value={s.exportScale} onChange={(exportScale) => s.set({ exportScale })} options={[0.25, 0.5, 0.75, 1, 1.5, 2].map((k) => ({ value: k, label: `${k * 100} %` }))} />
              </Row>
            </>
          )}
          {section === 'storage' && <StorageSection />}
          {section === 'shortcuts' && <ShortcutEditor />}
          {section === 'about' && (
            <div className="col">
              <div className="row">
                <Logo size={48} />
                <div>
                  <strong>{t('app.name')}</strong>
                  <div className="small muted">{t('settings.version', { v: __APP_VERSION__ })}</div>
                </div>
              </div>
              <p>{t('settings.privacy')}</p>
              <div className="section-title">{t('settings.licenses')}</div>
              <div className="small muted">
                React (MIT), Capacitor (MIT), Zustand (MIT), fflate (MIT), gifenc (MIT), mp4-muxer / webm-muxer (MIT), Lucide icons (ISC), polices Inter, Lora, Fredoka, Bangers, Caveat, Permanent Marker, Roboto Mono (SIL OFL 1.1).
              </div>
              <Button
                variant="danger"
                onClick={async () => {
                  if (await dialogs.confirm(t('settings.reset'), t('settings.resetConfirm'), t('common.reset'), true)) s.reset();
                }}
              >
                {t('settings.reset')}
              </Button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
