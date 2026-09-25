import { newFrame, newLayer } from '../../core/model/project';
import { insertFrames, uniqueLayerName } from '../../core/model/ops';
import { uid } from '../../core/util/id';
import { nextTick } from '../../core/util/async';
import type { AudioClipDef, AudioTrackDef, FrameDef } from '../../core/model/types';
import type { EditorController } from '../../editor/controller';
import { setUi } from '../../editor/controller';
import { floatCanvas } from '../../editor/selectionOps';
import { blobToBitmap, createCanvas, ctx2d, loadImage } from '../../engine/canvas';
import { decodeAudio } from '../../engine/audio/AudioEngine';
import { t } from '../../i18n';
import { showError } from '../../app/store';
import { toast } from '../components/toast';

const MAX_IMPORT_BYTES = 512 * 1024 * 1024;

/** Decode any image file the WebView understands (PNG, JPEG, WebP, GIF, BMP, SVG…). */
export async function decodeImage(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await blobToBitmap(file);
  } catch {
    return loadImage(file);
  }
}

function dims(img: ImageBitmap | HTMLImageElement): { w: number; h: number } {
  return 'naturalWidth' in img ? { w: img.naturalWidth, h: img.naturalHeight } : { w: img.width, h: img.height };
}

/** Draw an image centred in a project-sized canvas. */
function fitted(img: CanvasImageSource, w: number, h: number, W: number, H: number, mode: 'contain' | 'shrink' | 'cover' | 'stretch'): HTMLCanvasElement {
  const c = createCanvas(W, H);
  const ctx = ctx2d(c);
  ctx.imageSmoothingQuality = 'high';
  if (mode === 'stretch') {
    ctx.drawImage(img, 0, 0, W, H);
    return c;
  }
  const k = mode === 'cover' ? Math.max(W / w, H / h) : mode === 'contain' ? Math.min(W / w, H / h) : Math.min(1, W / w, H / h);
  const dw = w * k,
    dh = h * k;
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  return c;
}

/** Image into a new layer of the current frame (one undo step). */
export async function importImageAsLayer(ctrl: EditorController, file: File): Promise<void> {
  const s = ctrl.session;
  try {
    const img = await decodeImage(file);
    const { w, h } = dims(img);
    const canvas = fitted(img, w, h, s.doc.width, s.doc.height, 'shrink');
    const layer = newLayer(file.name.replace(/\.[^.]+$/, '').slice(0, 60) || uniqueLayerName(s.doc.layers, s.opts.layerName));
    const layers = [...s.doc.layers.slice(0, s.layerIndex + 1), layer, ...s.doc.layers.slice(s.layerIndex + 1)];
    const celId = s.cels.createFrom(canvas);
    const frames = s.doc.frames.map((f, i) => (i === s.frameIndex ? { ...f, cels: { ...f.cels, [layer.id]: celId } } : f));
    s.change('history.import', { layers, frames }, { layerId: layer.id });
  } catch (e) {
    await showError(e, 'error.imageDecode');
  }
}

/** Image as a floating object on the active layer, ready to be transformed. */
export async function importImageFloating(ctrl: EditorController, file: File): Promise<void> {
  const s = ctrl.session;
  try {
    const img = await decodeImage(file);
    const { w, h } = dims(img);
    const k = Math.min(1, s.doc.width / w, s.doc.height / h);
    const c = createCanvas(w * k, h * k);
    const ctx = ctx2d(c);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    if (await floatCanvas(s, c, 'import')) ctrl.setTool('transform');
    else toast(s.editBlocker() === 'locked' ? 'toast.layerLocked' : 'toast.layerHidden', 'error');
  } catch (e) {
    await showError(e, 'error.imageDecode');
  }
}

export interface SequenceOptions {
  target: 'newLayer' | 'current';
  at: 'current' | 'end';
  fit: 'contain' | 'cover' | 'stretch' | 'shrink';
}

const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Import a list of images, one per frame. Frames are created as needed.
 * Pixels are encoded to storage progressively to keep memory bounded.
 */
export async function importSequence(
  ctrl: EditorController,
  files: File[],
  opts: SequenceOptions = { target: 'newLayer', at: 'current', fit: 'contain' },
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const s = ctrl.session;
  const sorted = [...files].filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name)).sort((a, b) => natural.compare(a.name, b.name));
  if (!sorted.length) return 0;
  let layers = s.doc.layers;
  let layerId = s.layerId;
  if (opts.target === 'newLayer') {
    const prefix = sorted[0].name.replace(/[\d_\-. ]*\.[^.]+$/, '').slice(0, 40);
    const l = newLayer(prefix || uniqueLayerName(layers, s.opts.layerName));
    layers = [...layers.slice(0, s.layerIndex + 1), l, ...layers.slice(s.layerIndex + 1)];
    layerId = l.id;
  }
  let frames: FrameDef[] = [...s.doc.frames];
  let start = opts.at === 'end' ? frames.length : s.frameIndex;
  if (opts.at === 'end') {
    // Reuse the only frame of a brand-new empty project.
    if (frames.length === 1 && !Object.keys(frames[0].cels).length) start = 0;
  }
  setUi({ busy: t('import.sequenceProgress'), progress: 0 });
  let n = 0;
  try {
    for (let i = 0; i < sorted.length; i++) {
      const img = await decodeImage(sorted[i]);
      const { w, h } = dims(img);
      const canvas = fitted(img, w, h, s.doc.width, s.doc.height, opts.fit);
      if ('close' in img) img.close();
      const celId = s.cels.createFrom(canvas);
      const idx = start + i;
      if (idx >= frames.length) frames = insertFrames(frames, frames.length, [newFrame()]);
      const f = frames[idx];
      frames[idx] = { ...f, cels: { ...f.cels, [layerId]: celId } };
      if (Math.abs(idx - s.frameIndex) > 2) await s.cels.spill(celId);
      n++;
      onProgress?.(n, sorted.length);
      setUi({ progress: n / sorted.length });
      if (i % 4 === 3) await nextTick();
    }
  } finally {
    setUi({ busy: null, progress: null });
  }
  s.change('history.import', layers !== s.doc.layers ? { layers, frames } : { frames }, { layerId, frameIndex: start });
  toast('import.sequenceDone', 'success', { n });
  return n;
}

/** Add an audio file as a clip at the playhead (on the first track, created if needed). */
export async function importAudio(ctrl: EditorController, file: Blob & { name?: string }, at?: number): Promise<AudioClipDef | null> {
  const s = ctrl.session;
  if (file.size > MAX_IMPORT_BYTES) {
    toast('misc.fileTooBig', 'error');
    return null;
  }
  let buf: AudioBuffer;
  try {
    buf = await decodeAudio(await file.arrayBuffer());
  } catch (e) {
    await showError(e, 'error.audioDecode');
    return null;
  }
  const key = uid('a');
  await s.repo.putAsset(s.doc.id, key, file);
  ctrl.audio.prime(key, buf);
  const starts = s.doc.frames.slice(0, s.frameIndex).reduce((a, f) => a + f.hold, 0);
  const clip: AudioClipDef = {
    id: uid('ac'),
    name: (file.name ?? 'audio').slice(0, 120),
    assetKey: key,
    mime: file.type || 'audio/mpeg',
    start: at ?? starts / s.doc.fps,
    offset: 0,
    duration: buf.duration,
    sourceDuration: buf.duration,
    volume: 1,
    muted: false,
  };
  let audio: AudioTrackDef[];
  if (!s.doc.audio.length) audio = [{ id: uid('at'), name: t('audio.track', { n: 1 }), volume: 1, muted: false, clips: [clip] }];
  else {
    // First track with free space at that position, otherwise a new track.
    const free = s.doc.audio.findIndex((tr) => tr.clips.every((c) => c.start >= clip.start + clip.duration || c.start + c.duration <= clip.start));
    if (free >= 0) audio = s.doc.audio.map((tr, i) => (i === free ? { ...tr, clips: [...tr.clips, clip] } : tr));
    else audio = [...s.doc.audio, { id: uid('at'), name: t('audio.track', { n: s.doc.audio.length + 1 }), volume: 1, muted: false, clips: [clip] }];
  }
  s.change('history.audio', { audio });
  return clip;
}

export async function importReference(ctrl: EditorController, file: File): Promise<void> {
  try {
    const ref = await ctrl.session.addReference(file, file.name);
    const { tools } = await import('../../editor/toolStore');
    tools().set({ referenceId: ref.id });
    setUi({ panelTab: 'refs' });
  } catch (e) {
    await showError(e, 'error.imageDecode');
  }
}

export function openVideoImport(file: File): void {
  setUi({ dialog: 'videoImport', dialogArg: file });
}

/** Drag & drop onto the canvas. */
export async function importDroppedFiles(ctrl: EditorController, files: File[]): Promise<void> {
  const images = files.filter((f) => f.type.startsWith('image/'));
  const audio = files.find((f) => f.type.startsWith('audio/'));
  const video = files.find((f) => f.type.startsWith('video/'));
  if (video) return openVideoImport(video);
  if (audio) {
    await importAudio(ctrl, audio);
    return;
  }
  if (images.length > 1) {
    await importSequence(ctrl, images);
    return;
  }
  if (images.length === 1) return importImageFloating(ctrl, images[0]);
  toast('import.unsupported', 'error');
}
