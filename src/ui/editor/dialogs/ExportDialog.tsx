import { Download, FileArchive, Film, FolderDown, Image as ImageIcon, Images, LayoutGrid, Share2, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatBytes, formatTime } from '../../../core/util/math';
import { resampleIndices } from '../../../core/model/timing';
import { FPS_CHOICES } from '../../../core/model/presets';
import { setUi } from '../../../editor/controller';
import { estimateSize, even, pickVideoCodec, runExport, videoBitrate, MAX_SHEET, type ExportFormat, type ExportOptions, type ExportResult, type Quality } from '../../../engine/export/exporter';
import { useT } from '../../../i18n';
import { canSaveToGallery, canShare, isNative, saveFile, saveToGallery, shareFile } from '../../../platform/platform';
import { settings } from '../../../storage/settings';
import { Dialog } from '../../components/Dialog';
import { friendlyError, isCancel } from '../../components/errors';
import { ErrorBody } from '../../components/dialogs';
import { toast } from '../../components/toast';
import { Button, Field, NumberInput, Progress, Segmented, SelectInput, Toggle, type IconType } from '../../components/ui';
import { useCtrl, useSession } from '../context';

const FORMATS: { id: ExportFormat; icon: IconType; key: string }[] = [
  { id: 'mp4', icon: Film, key: 'export.mp4' },
  { id: 'gif', icon: Sparkles, key: 'export.gif' },
  { id: 'webm', icon: Film, key: 'export.webm' },
  { id: 'png', icon: ImageIcon, key: 'export.png' },
  { id: 'pngseq', icon: Images, key: 'export.pngSeq' },
  { id: 'spritesheet', icon: LayoutGrid, key: 'export.spritesheet' },
  { id: 'project', icon: FileArchive, key: 'export.project' },
];

export default function ExportDialog() {
  const t = useT();
  const ctrl = useCtrl();
  const s = useSession();
  const doc = s.doc;
  const [format, setFormat] = useState<ExportFormat>('mp4');
  const [scale, setScale] = useState(settings().exportScale);
  const [fps, setFps] = useState(doc.fps);
  const [quality, setQuality] = useState<Quality>(settings().exportQuality);
  const [transparent, setTransparent] = useState(doc.background.transparent);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(doc.frames.length);
  const [audio, setAudio] = useState(true);
  const [loop, setLoop] = useState(true);
  const [refs, setRefs] = useState(false);
  const [columns, setColumns] = useState(Math.min(8, Math.ceil(Math.sqrt(doc.frames.length))));
  const [estimate, setEstimate] = useState<number | null | 'busy'>('busy');
  const [codecNote, setCodecNote] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<{ key: string; details: string } | null>(null);
  const token = useRef({ cancelled: false });
  const previewUrl = useMemo(() => (result ? URL.createObjectURL(result.blob) : null), [result]);
  useEffect(() => () => void (previewUrl && URL.revokeObjectURL(previewUrl)), [previewUrl]);

  const width = Math.max(2, Math.round(doc.width * scale));
  const height = Math.max(2, Math.round(doc.height * scale));
  const video = format === 'mp4' || format === 'webm';
  const supportsTransparency = format === 'gif' || format === 'png' || format === 'pngseq' || format === 'spritesheet' || format === 'webm';
  const hasAudio = doc.audio.some((x) => x.clips.length > 0);

  const opts: ExportOptions = useMemo(
    () => ({
      format,
      width,
      height,
      fps,
      quality,
      transparent: supportsTransparency && transparent,
      from: Math.min(from, to) - 1,
      to: Math.max(from, to) - 1,
      audio,
      loop,
      references: refs,
      columns,
    }),
    [format, width, height, fps, quality, transparent, supportsTransparency, from, to, audio, loop, refs, columns],
  );

  const outFrames = format === 'gif' || format === 'spritesheet' ? opts.to - opts.from + 1 : resampleIndices(doc.frames, doc.fps, fps, opts.from, opts.to).length;
  const outDuration = format === 'gif' ? doc.frames.slice(opts.from, opts.to + 1).reduce((a, f) => a + f.hold, 0) / doc.fps : outFrames / fps;

  // Size estimate (debounced).
  useEffect(() => {
    setEstimate('busy');
    const id = setTimeout(() => {
      estimateSize(s, opts)
        .then(setEstimate)
        .catch(() => setEstimate(null));
    }, 250);
    return () => clearTimeout(id);
  }, [s, opts]);

  // Codec availability for video formats.
  useEffect(() => {
    if (!video) return setCodecNote(null);
    let alive = true;
    void pickVideoCodec(format as 'mp4' | 'webm', even(width), even(height), fps, videoBitrate({ width, height, fps, quality })).then((c) => {
      if (!alive) return;
      if (!c) setCodecNote(t('export.noVideoEncoder'));
      else if (format === 'mp4' && !c.label.startsWith('H.264')) setCodecNote(t('export.mp4Fallback', { codec: c.label }));
      else setCodecNote(t('export.codecInfo', { codec: c.label }));
    });
    return () => {
      alive = false;
    };
  }, [format, video, width, height, fps, quality, t]);

  const close = () => {
    token.current.cancelled = true;
    setUi({ dialog: null });
  };

  const start = async () => {
    token.current = { cancelled: false };
    setResult(null);
    setError(null);
    setProgress(0);
    ctrl.stopPlayback();
    try {
      const r = await runExport(s, ctrl.audio, opts, (p) => setProgress(p), token.current);
      setResult(r);
      toast('toast.exported', 'success');
    } catch (e) {
      if (isCancel(e)) toast('export.cancelled');
      else {
        console.error(e);
        const f = friendlyError(e, 'error.exportFailed');
        setError({ key: (e as Error)?.message === 'no-video-encoder' ? 'export.noVideoEncoder' : f.key, details: f.details });
      }
    } finally {
      setProgress(null);
    }
  };

  const busy = progress !== null;
  const tooBigSheet = format === 'spritesheet' && (columns * width > MAX_SHEET || Math.ceil(outFrames / columns) * height > MAX_SHEET);

  return (
    <Dialog
      title={t('export.title')}
      onClose={busy ? undefined : close}
      modal={busy}
      size="wide"
      testId="export-dialog"
      footer={
        busy ? (
          <Button onClick={() => (token.current.cancelled = true)}>{t('export.cancel')}</Button>
        ) : result ? (
          <>
            <Button onClick={() => setResult(null)}>{t('common.back')}</Button>
            {canSaveToGallery() && ['video/mp4', 'image/gif', 'image/png', 'video/webm'].includes(result.mime) && (
              <Button icon={FolderDown} onClick={async () => { try { if (await saveToGallery(result.blob, result.name, result.mime)) toast('export.savedGallery', 'success'); } catch (e) { setError(friendlyError(e, 'error.exportFailed')); } }}>
                {t('export.saveToGallery')}
              </Button>
            )}
            {canShare() && (
              <Button icon={Share2} onClick={() => void shareFile(result.blob, result.name, result.mime).catch(() => undefined)}>
                {t('export.share')}
              </Button>
            )}
            <Button variant="primary" icon={Download} testId="export-save" onClick={async () => { try { if (await saveFile(result.blob, result.name, result.mime)) toast('export.saved', 'success'); } catch (e) { setError(friendlyError(e, 'error.exportFailed')); } }}>
              {isNative() ? t('export.saveAs') : t('export.download')}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={close}>{t('common.cancel')}</Button>
            <Button variant="primary" icon={Download} onClick={() => void start()} disabled={tooBigSheet || (video && codecNote === t('export.noVideoEncoder'))} testId="export-start">
              {t('export.start')}
            </Button>
          </>
        )
      }
    >
      {busy && (
        <div className="col" data-testid="export-progress">
          <div>{t('export.progress', { p: Math.round((progress ?? 0) * 100) })}</div>
          <Progress value={progress ?? 0} />
        </div>
      )}
      {result && !busy && (
        <div className="export-result" data-testid="export-result">
          <strong>{t('export.done')}</strong>
          <div className="small muted">{t('export.result', { name: result.name, size: formatBytes(result.blob.size) })}</div>
          {result.codec && <div className="small muted">{t('export.codecInfo', { codec: result.codec })}</div>}
          {result.mime.startsWith('video/') && <video className="export-preview" src={previewUrl ?? undefined} controls loop playsInline />}
          {result.mime.startsWith('image/') && <img className="export-preview" src={previewUrl ?? undefined} alt={result.name} />}
        </div>
      )}
      {error && !busy && <ErrorBody message={t(error.key)} details={error.details} />}
      {!busy && !result && (
        <>
          <div className="format-grid" role="radiogroup" aria-label={t('export.format')}>
            {FORMATS.map((f) => (
              <button key={f.id} type="button" role="radio" aria-checked={format === f.id} className={`format-card${format === f.id ? ' on' : ''}`} onClick={() => setFormat(f.id)} data-testid={`format-${f.id}`}>
                <f.icon size={22} aria-hidden />
                <span>{t(f.key)}</span>
              </button>
            ))}
          </div>
          {format !== 'project' && (
            <>
              <div className="row wrap" style={{ gap: 16, alignItems: 'flex-end' }}>
                <Field label={t('export.scale')}>
                  <SelectInput label={t('export.scale')} value={scale} onChange={setScale} options={[0.25, 0.5, 0.75, 1, 1.5, 2].map((k) => ({ value: k, label: `${Math.round(k * 100)} %` }))} />
                </Field>
                <div className="small muted" style={{ paddingBottom: 10 }}>
                  {t('export.resolution')} : <strong>{video ? even(width) : width} × {video ? even(height) : height}</strong>
                </div>
                {(video || format === 'pngseq') && (
                  <Field label={t('export.fps')}>
                    <SelectInput label={t('export.fps')} value={fps} onChange={setFps} options={[...new Set([...FPS_CHOICES, doc.fps])].sort((a, b) => a - b).map((f) => ({ value: f, label: `${f}` }))} />
                  </Field>
                )}
                {video && (
                  <Field label={t('export.quality')}>
                    <Segmented value={quality} label={t('export.quality')} onChange={setQuality} options={[{ value: 'low', label: t('export.qualityLow') }, { value: 'medium', label: t('export.qualityMedium') }, { value: 'high', label: t('export.qualityHigh') }]} />
                  </Field>
                )}
                {format === 'spritesheet' && (
                  <Field label={t('export.sprites.columns')}>
                    <NumberInput label={t('export.sprites.columns')} value={columns} min={1} max={64} onChange={setColumns} />
                  </Field>
                )}
              </div>
              {format !== 'png' && (
                <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
                  <span className="field-label">{t('export.range')}</span>
                  <Field label={t('export.from')}>
                    <NumberInput label={t('export.from')} value={from} min={1} max={doc.frames.length} onChange={setFrom} testId="export-from" />
                  </Field>
                  <Field label={t('export.to')}>
                    <NumberInput label={t('export.to')} value={to} min={1} max={doc.frames.length} onChange={setTo} testId="export-to" />
                  </Field>
                  <span className="small muted" style={{ paddingBottom: 10 }}>
                    {t('export.frames', { n: outFrames, duration: formatTime(outDuration) })}
                  </span>
                </div>
              )}
              <div className="grid-2">
                {supportsTransparency ? <Toggle label={t('export.transparent')} checked={transparent} onChange={setTransparent} /> : <div className="small muted">{t('export.noTransparency')}</div>}
                {video && <Toggle label={t('export.audio')} checked={audio && hasAudio} disabled={!hasAudio} onChange={setAudio} />}
                {format === 'gif' && <Toggle label={t('export.loop')} checked={loop} onChange={setLoop} />}
                {doc.references.some((r) => r.exportable) && <Toggle label={t('export.references')} checked={refs} onChange={setRefs} />}
              </div>
              {codecNote && <div className="small muted">{codecNote}</div>}
              {tooBigSheet && <div className="small" style={{ color: 'var(--danger)' }}>{`> ${MAX_SHEET}px`}</div>}
            </>
          )}
          <div className="row">
            <span className="small">{estimate === 'busy' ? t('export.estimating') : estimate !== null ? t('export.estimate', { size: formatBytes(estimate) }) : ''}</span>
          </div>
          <div className="small faint">{t('export.neverOverwrite')}</div>
        </>
      )}
    </Dialog>
  );
}
