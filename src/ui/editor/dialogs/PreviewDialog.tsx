import { Maximize, Minimize, Pause, Play, Repeat, SkipBack, StepBack, StepForward, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { frameStarts, totalTicks } from '../../../core/model/timing';
import { formatTime } from '../../../core/util/math';
import { setUi } from '../../../editor/controller';
import { Player, SPEEDS } from '../../../engine/Player';
import { useT } from '../../../i18n';
import { settings } from '../../../storage/settings';
import { pushBack } from '../../components/back';
import { ctx2d } from '../../../engine/canvas';
import { IconButton, SelectInput } from '../../components/ui';
import { useCtrl, useSession } from '../context';

/** Full-screen player with its own Player instance (the editor view is untouched). */
export default function PreviewDialog() {
  const t = useT();
  const ctrl = useCtrl();
  const s = useSession();
  const player = useMemo(() => new Player(s, ctrl.audio, 2048), [s, ctrl.audio]);
  const view = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState({ playing: false, frame: s.frameIndex });
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(settings().loopPlayback);
  const [full, setFull] = useState(false);
  const starts = useMemo(() => frameStarts(s.doc.frames), [s.doc.frames]);
  const total = totalTicks(s.doc.frames);

  const paint = () => {
    const c = view.current;
    const b = box.current;
    if (!c || !b) return;
    const r = b.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const k = Math.min(r.width / s.doc.width, r.height / s.doc.height);
    const w = Math.max(1, Math.floor(s.doc.width * k)),
      h = Math.max(1, Math.floor(s.doc.height * k));
    if (c.width !== w * dpr || c.height !== h * dpr) {
      c.width = w * dpr;
      c.height = h * dpr;
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    const ctx = ctx2d(c);
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(player.canvas, 0, 0, c.width, c.height);
  };

  useEffect(() => {
    player.loop = loop;
    const off = player.changed.on((st) => {
      setState(st);
      paint();
    });
    const show = async () => {
      const f = s.doc.frames[state.frame];
      if (f) {
        const { ensureFrameLoaded } = await import('../../../engine/render');
        await ensureFrameLoaded(s.doc, f, s.cels);
      }
      player.drawFrame(state.frame);
      paint();
    };
    void show();
    if (settings().autoPlayPreview) void player.play(s.frameIndex);
    const ro = new ResizeObserver(paint);
    if (box.current) ro.observe(box.current);
    const back = pushBack(() => {
      close();
      return true;
    });
    const key = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        player.toggle();
      } else if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') stepBy(1);
      else if (e.key === 'ArrowLeft') stepBy(-1);
    };
    window.addEventListener('keydown', key, true);
    return () => {
      off();
      ro.disconnect();
      back();
      window.removeEventListener('keydown', key, true);
      player.dispose();
    };
  }, [player]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    player.pause();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    setUi({ dialog: null });
  };
  const stepBy = (d: number) => {
    player.pause();
    const n = s.doc.frames.length;
    const i = (player.frame + d + n) % n;
    player.frame = i;
    player.drawFrame(i);
    setState({ playing: false, frame: i });
    paint();
  };
  const toggleFull = () => {
    const el = box.current?.parentElement;
    try {
      if (!document.fullscreenElement && el?.requestFullscreen) void el.requestFullscreen().catch(() => undefined);
      else if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    } catch {
      /* fallback: CSS fullscreen */
    }
    setFull(!full);
  };

  return (
    <div className={`preview${full ? ' full' : ''}`} role="dialog" aria-label={t('preview.title')} data-testid="preview">
      <div className="preview-stage" ref={box} onClick={() => player.toggle()}>
        <canvas ref={view} className="preview-canvas" />
      </div>
      <div className="preview-bar">
        <IconButton icon={X} label={t('preview.close')} onClick={close} testId="preview-close" />
        <IconButton icon={SkipBack} label={t('preview.fromStart')} onClick={() => { player.pause(); void player.play(0); }} />
        <IconButton icon={StepBack} label={t('timeline.prev')} onClick={() => stepBy(-1)} />
        <IconButton icon={state.playing ? Pause : Play} active label={state.playing ? t('timeline.pause') : t('timeline.play')} onClick={() => player.toggle()} testId="preview-play" />
        <IconButton icon={StepForward} label={t('timeline.next')} onClick={() => stepBy(1)} />
        <IconButton icon={Repeat} toggled={loop} label={t('preview.loop')} onClick={() => { player.loop = !loop; setLoop(!loop); }} />
        <SelectInput label={t('preview.speed')} value={speed} onChange={(v) => { player.setSpeed(v); setSpeed(v); }} options={SPEEDS.map((x) => ({ value: x, label: `${x}×` }))} />
        <input
          type="range"
          className="grow"
          min={0}
          max={s.doc.frames.length - 1}
          value={state.frame}
          aria-label={t('timeline.frame', { n: state.frame + 1 })}
          style={{ ['--fill' as string]: `${(state.frame / Math.max(1, s.doc.frames.length - 1)) * 100}%` }}
          onChange={(e) => {
            const i = parseInt(e.target.value, 10);
            player.pause();
            player.frame = i;
            player.drawFrame(i);
            setState({ playing: false, frame: i });
            paint();
          }}
        />
        <span className="small preview-time">
          {state.frame + 1}/{s.doc.frames.length} · {formatTime((starts[state.frame] ?? 0) / s.doc.fps)} / {formatTime(total / s.doc.fps)}
        </span>
        <IconButton icon={full ? Minimize : Maximize} label={t('preview.fullscreen')} onClick={toggleFull} />
      </div>
    </div>
  );
}
