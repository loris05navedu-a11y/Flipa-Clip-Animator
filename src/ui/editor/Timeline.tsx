import {
  ChevronsLeft, ChevronsRight, ClipboardPaste, Copy, CopyPlus, Layers, ListChecks, Minus, MoreHorizontal, Pause, Play, Plus, Repeat, SkipBack, SkipForward,
  Square, StepBack, StepForward, Trash2, ArrowLeftToLine, ArrowRightToLine, Volume2, VolumeX, FileAudio, Undo2, SquarePlus,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { frameStarts, totalTicks } from '../../core/model/timing';
import { formatTime } from '../../core/util/math';
import type { AudioClipDef, AudioTrackDef } from '../../core/model/types';
import { MAX_FPS, MIN_FPS } from '../../core/model/presets';
import { useT } from '../../i18n';
import { setUi, useEditorUi } from '../../editor/controller';
import { SPEEDS } from '../../engine/Player';
import { Thumbnails } from '../../engine/Thumbnails';
import { ctx2d } from '../../engine/canvas';
import { useSettings } from '../../storage/settings';
import { pickFiles } from '../../platform/platform';
import { clipboard } from '../../engine/Clipboard';
import { dialogs } from '../components/dialogs';
import { Menu, type MenuEntry } from '../components/Menu';
import { IconButton, NumberInput, SelectInput } from '../components/ui';
import { useCtrl, useSession } from './context';
import { importAudio } from './importActions';

const LABEL_W = 88;
const FRAME_ROW_H = 84;
const LAYER_ROW_H = 26;
const AUDIO_ROW_H = 46;
const RULER_H = 22;

function FrameThumb({ thumbs, frameId, version }: { thumbs: Thumbnails; frameId: string; version: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => thumbs.ready.on((id) => id === frameId && setTick((x) => x + 1)), [thumbs, frameId]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const img = thumbs.get(frameId) ?? thumbs.stale(frameId);
    if (!img) return;
    c.width = img.width;
    c.height = img.height;
    ctx2d(c).drawImage(img, 0, 0);
  }, [thumbs, frameId, version, tick]);
  return <canvas ref={ref} className="frame-thumb" aria-hidden />;
}

function Waveform({ peaks, clip, width }: { peaks: Float32Array | null; clip: AudioClipDef; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !peaks) return;
    const w = Math.max(1, Math.min(4096, Math.round(width)));
    const h = AUDIO_ROW_H - 16;
    c.width = w;
    c.height = h;
    const ctx = ctx2d(c);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const buckets = peaks.length / 2;
    const b0 = (clip.offset / clip.sourceDuration) * buckets;
    const b1 = ((clip.offset + clip.duration) / clip.sourceDuration) * buckets;
    for (let x = 0; x < w; x++) {
      const b = Math.floor(b0 + ((b1 - b0) * x) / w);
      const min = peaks[b * 2] ?? 0,
        max = peaks[b * 2 + 1] ?? 0;
      const y0 = ((1 - max) / 2) * h,
        y1 = ((1 - min) / 2) * h;
      ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
  }, [peaks, clip.offset, clip.duration, clip.sourceDuration, width]);
  return <canvas ref={ref} className="waveform" aria-hidden />;
}

export function Timeline() {
  const t = useT();
  const ctrl = useCtrl();
  const s = useSession();
  const playing = useEditorUi((u) => u.playing);
  const showLayers = useEditorUi((u) => u.timelineLayers);
  const multi = useEditorUi((u) => u.multiSelect);
  const height = useSettings((x) => x.timelineHeight);
  const setSettings = useSettings((x) => x.set);
  const thumbs = useMemo(() => new Thumbnails(s), [s]);
  const scroller = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ left: 0, width: 800 });
  const [unit, setUnit] = useState(64);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; frameIndex: number } | null>(null);
  const [clipMenu, setClipMenu] = useState<{ anchor: HTMLElement; track: AudioTrackDef; clip: AudioClipDef } | null>(null);
  const [trackMenu, setTrackMenu] = useState<{ anchor: HTMLElement; track: AudioTrackDef } | null>(null);
  const [drag, setDrag] = useState<{ ids: string[]; x0: number; x: number; target: number } | null>(null);
  const [peaks, setPeaks] = useState<Record<string, Float32Array>>({});
  const [speed, setSpeed] = useState(ctrl.player.speed);
  const [loop, setLoop] = useState(ctrl.player.loop);
  const doc = s.doc;
  const starts = useMemo(() => frameStarts(doc.frames), [doc.frames]);
  const total = totalTicks(doc.frames);
  const contentW = total * unit + 200;
  const cur = s.frameIndex;
  const multiIds = s.frameSelection;

  useEffect(() => () => thumbs.clear(), [thumbs]);

  // Load waveforms.
  useEffect(() => {
    for (const tr of doc.audio)
      for (const c of tr.clips)
        if (!peaks[c.assetKey])
          ctrl.audio
            .waveform(c.assetKey)
            .then((p) => setPeaks((old) => ({ ...old, [c.assetKey]: p })))
            .catch(() => undefined);
  }, [doc.audio, ctrl.audio, peaks]);

  // Keep the current frame visible.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const x = starts[cur] * unit;
    const w = (doc.frames[cur]?.hold ?? 1) * unit;
    const vis = el.clientWidth - LABEL_W;
    if (x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 20);
    else if (x + w > el.scrollLeft + vis) el.scrollLeft = x + w - vis + (playing ? vis * 0.6 : 40);
  }, [cur, unit, starts, doc.frames, playing]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const on = () => setScroll({ left: el.scrollLeft, width: el.clientWidth });
    on();
    el.addEventListener('scroll', on, { passive: true });
    const ro = new ResizeObserver(on);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', on);
      ro.disconnect();
    };
  }, []);

  // Visible frame range (virtualisation).
  const x0 = scroll.left - 200,
    x1 = scroll.left + scroll.width + 200;
  let first = 0;
  while (first < doc.frames.length - 1 && (starts[first] + doc.frames[first].hold) * unit < x0) first++;
  let last = first;
  while (last < doc.frames.length - 1 && starts[last + 1] * unit < x1) last++;

  const select = (i: number, e: React.MouseEvent | React.PointerEvent) => {
    const id = doc.frames[i].id;
    ctrl.stopPlayback();
    void s.commitFloating();
    if (e.shiftKey) s.selectFrame(id, 'range');
    else if (e.ctrlKey || e.metaKey || multi) s.selectFrame(id, 'toggle');
    else s.selectFrame(id, 'single');
  };

  /* Frame drag & drop (reorder) */
  const frameDown = (e: React.PointerEvent, i: number) => {
    if (e.button !== 0) return;
    const id = doc.frames[i].id;
    const ids = multiIds.has(id) ? doc.frames.filter((f) => multiIds.has(f.id)).map((f) => f.id) : [id];
    const start = e.clientX;
    let moved = false;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - start) < 10) return;
      moved = true;
      const rect = scroller.current!.getBoundingClientRect();
      const x = ev.clientX - rect.left - LABEL_W + scroller.current!.scrollLeft;
      // Auto-scroll near the edges.
      if (ev.clientX > rect.right - 40) scroller.current!.scrollLeft += 16;
      if (ev.clientX < rect.left + LABEL_W + 40) scroller.current!.scrollLeft -= 16;
      const tick = x / unit;
      let target = doc.frames.length;
      for (let k = 0; k < doc.frames.length; k++)
        if (tick < starts[k] + doc.frames[k].hold / 2) {
          target = k;
          break;
        }
      setDrag({ ids, x0: start, x, target });
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setDrag((d) => {
        if (moved && d) {
          ctrl.stopPlayback();
          s.moveFrames(d.ids, d.target);
        }
        return null;
      });
      if (!moved) select(i, ev as unknown as React.PointerEvent);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  /* Scrub on the ruler */
  const scrub = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const at = (clientX: number) => {
      const rect = scroller.current!.getBoundingClientRect();
      const x = clientX - rect.left - LABEL_W + scroller.current!.scrollLeft;
      const tick = Math.max(0, Math.floor(x / unit));
      let idx = 0;
      for (let k = 0; k < starts.length; k++) if (starts[k] <= tick) idx = k;
      if (idx !== s.frameIndex) ctrl.goFrame(idx);
    };
    at(e.clientX);
    const move = (ev: PointerEvent) => at(ev.clientX);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  /* Audio clip drag / trim */
  const clipGesture = useRef(0);
  const clipDown = (e: React.PointerEvent, track: AudioTrackDef, clip: AudioClipDef, mode: 'move' | 'in' | 'out') => {
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const g = ++clipGesture.current;
    const x0 = e.clientX;
    let moved = false;
    const orig = { ...clip };
    const fps = doc.fps;
    const snap = (sec: number) => Math.round(sec * fps) / fps;
    const move = (ev: PointerEvent) => {
      const dxSec = (ev.clientX - x0) / unit / fps;
      if (!moved && Math.abs(ev.clientX - x0) < 6) return;
      moved = true;
      let next: AudioClipDef;
      if (mode === 'move') next = { ...orig, start: Math.max(0, snap(orig.start + dxSec)) };
      else if (mode === 'in') {
        const d = Math.min(orig.duration - 0.05, Math.max(-orig.offset, dxSec));
        const ds = snap(orig.start + d) - orig.start;
        next = { ...orig, start: orig.start + ds, offset: Math.max(0, orig.offset + ds), duration: Math.max(0.05, orig.duration - ds) };
      } else next = { ...orig, duration: Math.max(0.05, Math.min(orig.sourceDuration - orig.offset, snap(orig.start + orig.duration + dxSec) - orig.start)) };
      const audio = s.doc.audio.map((tr) => (tr.id === track.id ? { ...tr, clips: tr.clips.map((c) => (c.id === clip.id ? next : c)) } : tr));
      s.change('history.audio', { audio }, undefined, `clip:${g}`);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (!moved) setClipMenu({ anchor: el, track, clip });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const updateTrack = (id: string, patch: Partial<AudioTrackDef>) => s.change('history.audio', { audio: s.doc.audio.map((tr) => (tr.id === id ? { ...tr, ...patch } : tr)) });
  const updateClip = (trackId: string, clipId: string, patch: Partial<AudioClipDef>, mergeKey?: string) =>
    s.change('history.audio', { audio: s.doc.audio.map((tr) => (tr.id === trackId ? { ...tr, clips: tr.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)) } : tr)) }, undefined, mergeKey);

  const splitClip = (track: AudioTrackDef, clip: AudioClipDef) => {
    const at = starts[cur] / doc.fps;
    if (at <= clip.start + 0.02 || at >= clip.start + clip.duration - 0.02) return;
    const d1 = at - clip.start;
    const a = { ...clip, duration: d1 };
    const b = { ...clip, id: clip.id + 's' + Math.floor(Math.random() * 1e6).toString(36), start: at, offset: clip.offset + d1, duration: clip.duration - d1 };
    s.change('history.audio', { audio: s.doc.audio.map((tr) => (tr.id === track.id ? { ...tr, clips: tr.clips.flatMap((c) => (c.id === clip.id ? [a, b] : [c])) } : tr)) });
  };

  const selCount = multiIds.size;
  const targetCount = selCount || 1;
  const frame = doc.frames[cur];

  const frameMenu = (i: number): MenuEntry[] => [
    { label: t('timeline.addFrame'), icon: Plus, onClick: () => s.addFrame('after') },
    { label: t('timeline.insertFrame'), icon: SquarePlus, onClick: () => s.addFrame('before') },
    { label: t('timeline.duplicate'), icon: CopyPlus, onClick: () => s.duplicateFrames() },
    { label: t('timeline.copy'), icon: Copy, onClick: () => void ctrl.copy() },
    { label: t('timeline.paste'), icon: ClipboardPaste, disabled: !clipboard.frames, onClick: () => void ctrl.paste() },
    { label: t('timeline.moveLeft'), icon: ArrowLeftToLine, disabled: i === 0, onClick: () => s.shiftFrames(-1) },
    { label: t('timeline.moveRight'), icon: ArrowRightToLine, disabled: i === doc.frames.length - 1, onClick: () => s.shiftFrames(1) },
    { label: t('timeline.reverse'), icon: Undo2, disabled: targetCount < 2, onClick: () => s.reverseFrames() },
    { label: t('timeline.selectAll'), icon: ListChecks, onClick: () => s.selectAllFrames() },
    'sep',
    { label: t('timeline.delete'), icon: Trash2, danger: true, onClick: () => void deleteFrames() },
  ];

  const deleteFrames = async () => {
    const n = s.targetFrameIds().length;
    if (n > 1 && !(await dialogs.confirm(t('timeline.delete'), t('timeline.deleteConfirm', { n }), t('common.delete'), true))) return;
    ctrl.stopPlayback();
    s.deleteFrames();
  };

  const resize = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const y0 = e.clientY,
      h0 = height;
    const move = (ev: PointerEvent) => setSettings({ timelineHeight: Math.max(96, Math.min(window.innerHeight * 0.7, h0 - (ev.clientY - y0))) });
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const layersTopFirst = [...doc.layers].reverse();
  const playheadX = starts[cur] * unit;

  return (
    <section className="timeline" style={{ height }} aria-label={t('timeline.title')} data-testid="timeline">
      <div className="tl-resize" onPointerDown={resize} role="separator" aria-orientation="horizontal" aria-label={t('timeline.title')} />
      <div className="tl-header">
        <div className="tl-transport">
          <IconButton icon={SkipBack} small label={t('timeline.first')} onClick={() => ctrl.goFrame(0)} />
          <IconButton icon={StepBack} small label={t('timeline.prev')} onClick={() => ctrl.step(-1)} testId="prev-frame" />
          <IconButton icon={playing ? Pause : Play} label={playing ? t('timeline.pause') : t('timeline.play')} active={playing} onClick={() => ctrl.togglePlay()} testId="play" />
          <IconButton icon={Square} small label={t('timeline.stop')} onClick={() => ctrl.stop()} testId="stop" />
          <IconButton icon={StepForward} small label={t('timeline.next')} onClick={() => ctrl.step(1)} testId="next-frame" />
          <IconButton icon={SkipForward} small label={t('timeline.last')} onClick={() => ctrl.goFrame(doc.frames.length - 1)} />
          <IconButton icon={Repeat} small label={t('timeline.loop')} toggled={loop} onClick={() => { ctrl.player.loop = !loop; setLoop(!loop); }} />
          <SelectInput label={t('timeline.speed')} value={speed} onChange={(v) => { ctrl.player.setSpeed(v); setSpeed(v); }} options={SPEEDS.map((x) => ({ value: x, label: `${x}×` }))} />
        </div>
        <div className="tl-info" data-testid="frame-counter">
          <strong>{t('editor.frameCounter', { n: cur + 1, total: doc.frames.length })}</strong>
          <span className="faint small hide-narrow">
            {formatTime(starts[cur] / doc.fps)} / {formatTime(total / doc.fps)}
          </span>
          <label className="fps-field" title={t('timeline.fps')}>
            <NumberInput label={t('timeline.fps')} value={doc.fps} min={MIN_FPS} max={MAX_FPS} width={52} testId="fps-input" onChange={(fps) => s.updateProject({ fps })} />
            <span className="small faint">{t('common.fps')}</span>
          </label>
        </div>
        <div className="tl-actions">
          <IconButton icon={Plus} label={t('timeline.addFrame')} onClick={() => (ctrl.stopPlayback(), s.addFrame('after'))} testId="add-frame" />
          <IconButton icon={CopyPlus} label={t('timeline.duplicate')} onClick={() => (ctrl.stopPlayback(), s.duplicateFrames())} testId="duplicate-frame" />
          <IconButton icon={Trash2} label={t('timeline.delete')} onClick={() => void deleteFrames()} testId="delete-frame" />
          <IconButton icon={Copy} small label={t('timeline.copy')} onClick={async () => { const { copyFrames } = await import('../../editor/frameClipboard'); const n = await copyFrames(s, s.targetFrameIds()); const { toast } = await import('../components/toast'); toast('timeline.copied', 'info', { n }); }} testId="copy-frames" />
          <IconButton icon={ClipboardPaste} small label={t('timeline.paste')} disabled={!clipboard.frames} onClick={async () => { const { pasteFrames } = await import('../../editor/frameClipboard'); await pasteFrames(s); }} testId="paste-frames" />
          <IconButton icon={ChevronsLeft} small label={t('timeline.moveLeft')} disabled={cur === 0 && !selCount} onClick={() => s.shiftFrames(-1)} />
          <IconButton icon={ChevronsRight} small label={t('timeline.moveRight')} onClick={() => s.shiftFrames(1)} />
          <div className="hold-ctl" title={t('timeline.hold')}>
            <IconButton icon={Minus} small label={t('timeline.holdMinus')} disabled={(frame?.hold ?? 1) <= 1} onClick={() => s.setHold((frame?.hold ?? 1) - 1)} testId="hold-minus" />
            <span className="small" data-testid="hold-value">{t('timeline.holdValue', { n: frame?.hold ?? 1 })}</span>
            <IconButton icon={Plus} small label={t('timeline.holdPlus')} onClick={() => s.setHold((frame?.hold ?? 1) + 1)} testId="hold-plus" />
          </div>
          <IconButton icon={ListChecks} small label={t('timeline.selectMode')} toggled={multi} onClick={() => { setUi({ multiSelect: !multi }); if (multi) s.clearFrameSelection(); }} testId="multi-select" />
          <IconButton icon={Layers} small label={t('timeline.layers')} toggled={showLayers} onClick={() => setUi({ timelineLayers: !showLayers })} testId="timeline-layers" />
          <IconButton icon={FileAudio} small label={t('audio.import')} onClick={async () => { const [f] = await pickFiles('audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus'); if (f) await importAudio(ctrl, f); }} />
          <input type="range" className="tl-zoom hide-narrow" min={16} max={160} value={unit} aria-label={t('timeline.zoom')} style={{ ['--fill' as string]: `${((unit - 16) / 144) * 100}%` }} onChange={(e) => setUnit(parseInt(e.target.value, 10))} />
          {selCount > 0 && <span className="chip on small" style={{ minHeight: 26 }}>{t('timeline.selected', { n: selCount })}</span>}
        </div>
      </div>

      <div className="tl-scroll scroll" ref={scroller}>
        <div className="tl-content" style={{ width: contentW + LABEL_W }}>
          {/* Ruler */}
          <div className="tl-row tl-ruler-row" style={{ height: RULER_H }}>
            <div className="tl-label" />
            <div className="tl-lane" onPointerDown={scrub}>
              {Array.from({ length: last - first + 1 }, (_, k) => first + k).map((i) => (
                <div key={i} className="tl-tick" style={{ left: starts[i] * unit }}>
                  {(i + 1) % (unit < 32 ? 5 : 1) === 0 || i === 0 ? i + 1 : ''}
                </div>
              ))}
            </div>
          </div>
          {/* Frames */}
          <div className="tl-row" style={{ height: FRAME_ROW_H }}>
            <div className="tl-label">{t('timeline.framesRow')}</div>
            <div className="tl-lane frames-lane" role="listbox" aria-label={t('timeline.title')}>
              {Array.from({ length: last - first + 1 }, (_, k) => first + k).map((i) => {
                const f = doc.frames[i];
                const on = i === cur;
                const selected = multiIds.has(f.id);
                const dragging = drag?.ids.includes(f.id);
                return (
                  <div
                    key={f.id}
                    role="option"
                    aria-selected={on}
                    aria-label={t('timeline.frame', { n: i + 1 })}
                    className={`frame-cell${on ? ' current' : ''}${selected ? ' selected' : ''}${dragging ? ' dragging' : ''}`}
                    style={{ left: starts[i] * unit, width: f.hold * unit - 4 }}
                    onPointerDown={(e) => frameDown(e, i)}
                    onDoubleClick={(e) => setMenu({ anchor: e.currentTarget as HTMLElement, frameIndex: i })}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({ anchor: e.currentTarget as HTMLElement, frameIndex: i });
                    }}
                    data-testid="frame-cell"
                  >
                    <FrameThumb thumbs={thumbs} frameId={f.id} version={s.renderVersion} />
                    <span className="frame-num">{i + 1}</span>
                    {f.hold > 1 && <span className="frame-hold">×{f.hold}</span>}
                    {on && (
                      <button
                        type="button"
                        className="frame-more"
                        aria-label={t('timeline.frameMenu')}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenu({ anchor: e.currentTarget, frameIndex: i });
                        }}
                      >
                        <MoreHorizontal size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
              {drag && <div className="drop-marker" style={{ left: (drag.target < doc.frames.length ? starts[drag.target] : total) * unit - 3 }} />}
              <button type="button" className="frame-add" style={{ left: total * unit + 4 }} onClick={() => { s.setFrame(doc.frames.length - 1); s.addFrame('after'); }} aria-label={t('timeline.addFrame')}>
                <Plus size={18} />
              </button>
            </div>
          </div>
          {/* Layers */}
          {showLayers &&
            layersTopFirst.map((l) => (
              <div key={l.id} className={`tl-row layer-lane-row${l.id === s.layerId ? ' active' : ''}`} style={{ height: LAYER_ROW_H }}>
                <div className="tl-label ellipsis" title={l.name} onClick={() => s.setLayer(l.id)}>
                  {l.name}
                </div>
                <div className="tl-lane">
                  {Array.from({ length: last - first + 1 }, (_, k) => first + k).map((i) => {
                    const f = doc.frames[i];
                    const celId = f.cels[l.id];
                    const filled = celId && !s.cels.isEmpty(celId);
                    return (
                      <button
                        type="button"
                        key={f.id}
                        className={`cel-cell${filled ? ' filled' : ''}${i === cur && l.id === s.layerId ? ' current' : ''}`}
                        style={{ left: starts[i] * unit, width: f.hold * unit - 4 }}
                        aria-label={`${l.name} · ${t('timeline.frame', { n: i + 1 })}`}
                        onClick={() => {
                          ctrl.goFrame(i);
                          s.setLayer(l.id);
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          {/* Audio */}
          {doc.audio.map((tr) => (
            <div key={tr.id} className="tl-row audio-row" style={{ height: AUDIO_ROW_H }}>
              <div className="tl-label audio-label">
                <button type="button" className="track-name ellipsis" onClick={(e) => setTrackMenu({ anchor: e.currentTarget, track: tr })} title={tr.name}>
                  {tr.name}
                </button>
                <button type="button" className="mini-icon" aria-label={tr.muted ? t('audio.unmute') : t('audio.mute')} onClick={() => updateTrack(tr.id, { muted: !tr.muted })}>
                  {tr.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                </button>
              </div>
              <div className="tl-lane">
                {tr.clips.map((c) => {
                  const left = c.start * doc.fps * unit;
                  const width = Math.max(8, c.duration * doc.fps * unit);
                  return (
                    <div
                      key={c.id}
                      className={`audio-clip${c.muted || tr.muted ? ' muted' : ''}`}
                      style={{ left, width }}
                      onPointerDown={(e) => clipDown(e, tr, c, 'move')}
                      data-testid="audio-clip"
                      title={c.name}
                    >
                      <Waveform peaks={peaks[c.assetKey] ?? null} clip={c} width={width} />
                      <span className="clip-name ellipsis">{c.name}</span>
                      <span className="clip-handle in" onPointerDown={(e) => clipDown(e, tr, c, 'in')} aria-hidden />
                      <span className="clip-handle out" onPointerDown={(e) => clipDown(e, tr, c, 'out')} aria-hidden />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {/* Playhead */}
          <div className="playhead" style={{ left: LABEL_W + playheadX }} aria-hidden />
        </div>
      </div>

      {menu && <Menu anchor={menu.anchor} onClose={() => setMenu(null)} items={frameMenu(menu.frameIndex)} />}
      {clipMenu && (
        <Menu anchor={clipMenu.anchor} onClose={() => setClipMenu(null)} width={300}>
          <ClipEditor track={clipMenu.track} clip={clipMenu.clip} onUpdate={(p, k) => updateClip(clipMenu.track.id, clipMenu.clip.id, p, k)} onSplit={() => { splitClip(clipMenu.track, clipMenu.clip); setClipMenu(null); }} onDelete={() => { s.change('history.audio', { audio: s.doc.audio.map((x) => (x.id === clipMenu.track.id ? { ...x, clips: x.clips.filter((c) => c.id !== clipMenu.clip.id) } : x)) }); setClipMenu(null); }} onPreview={() => void ctrl.audio.preview(clipMenu.clip)} />
        </Menu>
      )}
      {trackMenu && (
        <Menu
          anchor={trackMenu.anchor}
          onClose={() => setTrackMenu(null)}
          items={[
            { label: t('common.rename'), onClick: async () => { const n = await dialogs.prompt(t('common.rename'), t('common.name'), trackMenu.track.name); if (n) updateTrack(trackMenu.track.id, { name: n }); } },
            { label: trackMenu.track.muted ? t('audio.unmute') : t('audio.mute'), onClick: () => updateTrack(trackMenu.track.id, { muted: !trackMenu.track.muted }) },
            { label: `${t('audio.volume')} 50 %`, onClick: () => updateTrack(trackMenu.track.id, { volume: 0.5 }) },
            { label: `${t('audio.volume')} 100 %`, onClick: () => updateTrack(trackMenu.track.id, { volume: 1 }) },
            { label: `${t('audio.volume')} 150 %`, onClick: () => updateTrack(trackMenu.track.id, { volume: 1.5 }) },
            { label: t('audio.addTrack'), onClick: () => s.change('history.audio', { audio: [...s.doc.audio, { id: 'at' + Date.now().toString(36), name: t('audio.track', { n: s.doc.audio.length + 1 }), volume: 1, muted: false, clips: [] }] }) },
            'sep',
            { label: t('audio.deleteTrack'), danger: true, icon: Trash2, onClick: () => s.change('history.audio', { audio: s.doc.audio.filter((x) => x.id !== trackMenu.track.id) }) },
          ]}
        />
      )}
    </section>
  );
}

function ClipEditor({ track, clip, onUpdate, onSplit, onDelete, onPreview }: { track: AudioTrackDef; clip: AudioClipDef; onUpdate: (p: Partial<AudioClipDef>, mergeKey?: string) => void; onSplit: () => void; onDelete: () => void; onPreview: () => void }) {
  const t = useT();
  const s = useSession();
  const live = s.doc.audio.find((x) => x.id === track.id)?.clips.find((c) => c.id === clip.id) ?? clip;
  return (
    <div className="col clip-editor" data-testid="clip-editor">
      <div className="menu-title ellipsis">{live.name}</div>
      <label className="small">{t('audio.volume')} — {Math.round(live.volume * 100)} %</label>
      <input type="range" min={0} max={2} step={0.01} value={live.volume} style={{ ['--fill' as string]: `${(live.volume / 2) * 100}%` }} onChange={(e) => onUpdate({ volume: parseFloat(e.target.value) }, 'clipvol:' + clip.id)} aria-label={t('audio.volume')} />
      <div className="row">
        <span className="small grow">{t('audio.start')}</span>
        <NumberInput label={t('audio.start')} step={0.01} value={Math.round(live.start * 100) / 100} min={0} onChange={(v) => onUpdate({ start: v })} />
      </div>
      <div className="row">
        <span className="small grow">{t('audio.trimIn')}</span>
        <NumberInput label={t('audio.trimIn')} step={0.01} value={Math.round(live.offset * 100) / 100} min={0} max={live.sourceDuration - 0.05} onChange={(v) => onUpdate({ offset: v, duration: Math.min(live.duration, live.sourceDuration - v) })} />
      </div>
      <div className="row">
        <span className="small grow">{t('audio.duration')}</span>
        <NumberInput label={t('audio.duration')} step={0.01} value={Math.round(live.duration * 100) / 100} min={0.05} max={live.sourceDuration - live.offset} onChange={(v) => onUpdate({ duration: v })} />
      </div>
      <div className="row wrap">
        <button type="button" className="btn small" onClick={onPreview}>
          <Play size={14} /> {t('audio.preview')}
        </button>
        <button type="button" className="btn small" onClick={() => onUpdate({ muted: !live.muted })}>
          {live.muted ? t('audio.unmute') : t('audio.mute')}
        </button>
        <button type="button" className="btn small" onClick={onSplit}>
          {t('audio.split')}
        </button>
        <button type="button" className="btn small danger" onClick={onDelete}>
          {t('audio.delete')}
        </button>
      </div>
    </div>
  );
}
