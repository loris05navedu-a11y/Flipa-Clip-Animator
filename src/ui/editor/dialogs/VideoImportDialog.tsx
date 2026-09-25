import { useEffect, useMemo, useRef, useState } from 'react';
import { newFrame, newLayer } from '../../../core/model/project';
import { insertFrames, uniqueLayerName } from '../../../core/model/ops';
import { formatTime } from '../../../core/util/math';
import { nextTick } from '../../../core/util/async';
import type { FrameDef } from '../../../core/model/types';
import { setUi, useEditorUi } from '../../../editor/controller';
import { createCanvas, ctx2d } from '../../../engine/canvas';
import { useT } from '../../../i18n';
import { Dialog } from '../../components/Dialog';
import { toast } from '../../components/toast';
import { Button, Field, NumberInput, Progress, Segmented, SelectInput, Toggle } from '../../components/ui';
import { useCtrl, useSession } from '../context';
import { importAudio } from '../importActions';

/** Seek a video element and wait for the frame to be ready. */
function seek(v: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      v.removeEventListener('seeked', done);
      v.removeEventListener('error', fail);
      resolve();
    };
    const fail = () => {
      v.removeEventListener('seeked', done);
      reject(new Error('video-seek'));
    };
    v.addEventListener('seeked', done);
    v.addEventListener('error', fail);
    v.currentTime = time;
  });
}

export default function VideoImportDialog() {
  const t = useT();
  const ctrl = useCtrl();
  const s = useSession();
  const file = useEditorUi((u) => u.dialogArg) as File;
  const video = useRef<HTMLVideoElement | null>(null);
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  const [meta, setMeta] = useState<{ w: number; h: number; duration: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [fps, setFps] = useState(s.doc.fps);
  const [fit, setFit] = useState<'contain' | 'cover' | 'stretch'>('contain');
  const [scale, setScale] = useState(1);
  const [keepAudio, setKeepAudio] = useState(true);
  const [target, setTarget] = useState<'newLayer' | 'current'>('newLayer');
  const [at, setAt] = useState<'current' | 'end'>(s.doc.frames.length === 1 && !Object.keys(s.doc.frames[0].cels).length ? 'current' : 'current');
  const [progress, setProgress] = useState<{ n: number; total: number } | null>(null);
  const cancel = useRef(false);

  useEffect(() => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = url;
    v.onloadedmetadata = () => {
      const d = isFinite(v.duration) ? v.duration : 0;
      setMeta({ w: v.videoWidth, h: v.videoHeight, duration: d });
      setEnd(Math.min(d, 60));
    };
    v.onerror = () => setFailed(true);
    video.current = v;
    return () => {
      v.removeAttribute('src');
      v.load();
      URL.revokeObjectURL(url);
    };
  }, [url]);

  const count = Math.max(0, Math.floor((end - start) * fps));
  const close = () => {
    cancel.current = true;
    setUi({ dialog: null, dialogArg: null });
  };

  const run = async () => {
    const v = video.current!;
    if (!meta) return;
    cancel.current = false;
    const W = s.doc.width,
      H = s.doc.height;
    let layers = s.doc.layers;
    let layerId = s.layerId;
    if (target === 'newLayer') {
      const l = newLayer(file.name.replace(/\.[^.]+$/, '').slice(0, 40) || uniqueLayerName(layers, s.opts.layerName));
      layers = [...layers.slice(0, s.layerIndex + 1), l, ...layers.slice(s.layerIndex + 1)];
      layerId = l.id;
    }
    let frames: FrameDef[] = [...s.doc.frames];
    const first = at === 'end' ? (frames.length === 1 && !Object.keys(frames[0].cels).length ? 0 : frames.length) : s.frameIndex;
    // Extraction resolution (then fitted into the canvas).
    const k = Math.min(1, (Math.max(W, H) * scale) / Math.max(meta.w, meta.h));
    const tmp = createCanvas(Math.max(1, Math.round(meta.w * k)), Math.max(1, Math.round(meta.h * k)));
    const tctx = ctx2d(tmp);
    setProgress({ n: 0, total: count });
    let made = 0;
    try {
      for (let i = 0; i < count; i++) {
        if (cancel.current) break;
        await seek(v, Math.min(meta.duration - 0.001, start + i / fps + 0.0005));
        tctx.drawImage(v, 0, 0, tmp.width, tmp.height);
        const c = createCanvas(W, H);
        const ctx = ctx2d(c);
        ctx.imageSmoothingQuality = 'high';
        if (fit === 'stretch') ctx.drawImage(tmp, 0, 0, W, H);
        else {
          const f = fit === 'cover' ? Math.max(W / tmp.width, H / tmp.height) : Math.min(W / tmp.width, H / tmp.height);
          ctx.drawImage(tmp, (W - tmp.width * f) / 2, (H - tmp.height * f) / 2, tmp.width * f, tmp.height * f);
        }
        const celId = s.cels.createFrom(c);
        const idx = first + i;
        if (idx >= frames.length) frames = insertFrames(frames, frames.length, [newFrame()]);
        frames[idx] = { ...frames[idx], cels: { ...frames[idx].cels, [layerId]: celId } };
        if (idx - s.frameIndex > 2) await s.cels.spill(celId);
        made++;
        setProgress({ n: made, total: count });
        if (i % 2 === 0) await nextTick();
      }
      if (made) {
        s.change('history.import', layers !== s.doc.layers ? { layers, frames } : { frames }, { layerId, frameIndex: first });
        if (keepAudio) {
          const startSec = frames.slice(0, first).reduce((a, f) => a + f.hold, 0) / s.doc.fps;
          const clip = await importAudio(ctrl, file, startSec).catch(() => null);
          if (clip) {
            // Trim the clip to the imported range.
            const audio = s.doc.audio.map((tr) => ({ ...tr, clips: tr.clips.map((c) => (c.id === clip.id ? { ...c, offset: start, duration: Math.min(end - start, c.sourceDuration - start) } : c)) }));
            s.change('history.audio', { audio }, undefined, 'video-audio');
          } else toast('video.noAudio');
        }
        toast('video.done', 'success', { n: made });
      }
      close();
    } catch (e) {
      console.error(e);
      toast('video.failed', 'error');
      setProgress(null);
    }
  };

  return (
    <Dialog
      title={t('video.title')}
      onClose={progress ? undefined : close}
      modal={!!progress}
      testId="video-dialog"
      footer={
        progress ? (
          <Button onClick={() => (cancel.current = true)}>{t('common.cancel')}</Button>
        ) : (
          <>
            <Button onClick={close}>{t('common.cancel')}</Button>
            <Button variant="primary" disabled={!meta || count < 1} onClick={() => void run()} testId="video-import">
              {t('common.import')}
            </Button>
          </>
        )
      }
    >
      {failed && <div style={{ color: 'var(--danger)' }}>{t('video.failed')}</div>}
      {!meta && !failed && <div className="row"><div className="spinner" /> {t('video.loading')}</div>}
      {meta && !progress && (
        <>
          <div className="small muted">
            {file.name} — {t('video.info', { w: meta.w, h: meta.h, duration: formatTime(meta.duration) })}
          </div>
          <div className="row wrap" style={{ gap: 14, alignItems: 'flex-end' }}>
            <Field label={t('video.start')}>
              <NumberInput label={t('video.start')} step={0.01} value={start} min={0} max={meta.duration} onChange={(v) => setStart(Math.min(v, end))} />
            </Field>
            <Field label={t('video.end')}>
              <NumberInput label={t('video.end')} step={0.01} value={end} min={0} max={meta.duration} onChange={(v) => setEnd(Math.max(v, start))} testId="video-end" />
            </Field>
            <Field label={t('video.fps')}>
              <SelectInput label={t('video.fps')} value={fps} onChange={setFps} options={[...new Set([6, 8, 10, 12, 15, 24, 25, 30, s.doc.fps])].sort((a, b) => a - b).map((f) => ({ value: f, label: String(f) }))} />
            </Field>
            <Field label={t('video.scale')}>
              <SelectInput label={t('video.scale')} value={scale} onChange={setScale} options={[0.25, 0.5, 1].map((x) => ({ value: x, label: `${x * 100} %` }))} />
            </Field>
          </div>
          <Field label={t('video.resolution')}>
            <Segmented value={fit} label={t('video.resolution')} onChange={setFit} options={[{ value: 'contain', label: t('video.fit') }, { value: 'cover', label: t('video.fill') }, { value: 'stretch', label: t('video.stretch') }]} />
          </Field>
          <div className="row wrap" style={{ gap: 14 }}>
            <Field label={t('video.target')}>
              <Segmented value={target} label={t('video.target')} onChange={setTarget} options={[{ value: 'newLayer', label: t('video.newLayer') }, { value: 'current', label: t('video.currentLayer') }]} />
            </Field>
            <Field label={t('video.position')}>
              <Segmented value={at} label={t('video.position')} onChange={setAt} options={[{ value: 'current', label: t('video.atCurrent') }, { value: 'end', label: t('video.append') }]} />
            </Field>
          </div>
          <Toggle label={t('video.keepAudio')} checked={keepAudio} onChange={setKeepAudio} />
          <div className={count > 300 ? 'small' : 'small muted'} style={count > 300 ? { color: 'var(--warning)' } : undefined}>
            {t('video.count', { n: count })}
            {count > 300 && <> — {t('video.tooMany')}</>}
          </div>
        </>
      )}
      {progress && (
        <div className="col">
          <div>{t('video.importing', { n: progress.n, total: progress.total })}</div>
          <Progress value={progress.n / Math.max(1, progress.total)} />
        </div>
      )}
    </Dialog>
  );
}
