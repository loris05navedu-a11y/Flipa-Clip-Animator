import { Zip, ZipPassThrough } from 'fflate';
import { frameStarts, resampleIndices } from '../../core/model/timing';
import { CancelledError, nextTick, type CancelToken } from '../../core/util/async';
import type { EditorSession } from '../../editor/EditorSession';
import type { AudioEngine } from '../audio/AudioEngine';
import { canvasToBlob, createCanvas, ctx2d } from '../canvas';
import { composeFrame, ensureFrameLoaded } from '../render';

export type ExportFormat = 'mp4' | 'webm' | 'gif' | 'png' | 'pngseq' | 'spritesheet' | 'project';
export type Quality = 'low' | 'medium' | 'high';

export interface ExportOptions {
  format: ExportFormat;
  /** Output size (even numbers are enforced for video). */
  width: number;
  height: number;
  fps: number;
  quality: Quality;
  transparent: boolean;
  from: number;
  to: number;
  audio: boolean;
  loop: boolean;
  references: boolean;
  columns: number;
}

export interface ExportResult {
  blob: Blob;
  name: string;
  mime: string;
  codec?: string;
}

export type Progress = (p: number, label?: string) => void;

const BPP: Record<Quality, number> = { low: 0.04, medium: 0.08, high: 0.16 };

export function videoBitrate(o: Pick<ExportOptions, 'width' | 'height' | 'fps' | 'quality'>): number {
  return Math.round(Math.min(40e6, Math.max(400e3, o.width * o.height * o.fps * BPP[o.quality])));
}

export const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);

/** Renders frames at the output size. */
class FrameRenderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  constructor(
    private s: EditorSession,
    private o: ExportOptions,
  ) {
    this.canvas = createCanvas(o.width, o.height);
    this.ctx = ctx2d(this.canvas, { willReadFrequently: o.format === 'gif' });
  }
  async draw(index: number, opaque: boolean): Promise<HTMLCanvasElement> {
    const { doc } = this.s;
    const f = doc.frames[index];
    await ensureFrameLoaded(doc, f, this.s.cels);
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.o.width, this.o.height);
    if (opaque && doc.background.transparent) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, this.o.width, this.o.height);
    }
    ctx.setTransform(this.o.width / doc.width, 0, 0, this.o.height / doc.height, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    composeFrame(ctx, doc, f, this.s.cels, this.s, {
      background: opaque || !this.o.transparent,
      references: this.o.references ? 'exportable' : 'none',
    });
    return this.canvas;
  }
}

function check(token?: CancelToken): void {
  if (token?.cancelled) throw new CancelledError();
}

/* ------------------------------ Video ------------------------------ */

export interface VideoCodecChoice {
  codec: string;
  muxCodec: string;
  label: string;
}

/** Pick the best video codec the device can encode for a container. */
export async function pickVideoCodec(container: 'mp4' | 'webm', width: number, height: number, fps: number, bitrate: number, alpha = false): Promise<VideoCodecChoice | null> {
  if (typeof VideoEncoder === 'undefined') return null;
  const candidates: VideoCodecChoice[] =
    container === 'mp4'
      ? [
          { codec: 'avc1.640033', muxCodec: 'avc', label: 'H.264 High' },
          { codec: 'avc1.4D0033', muxCodec: 'avc', label: 'H.264 Main' },
          { codec: 'avc1.42E033', muxCodec: 'avc', label: 'H.264 Baseline' },
          { codec: 'avc1.640028', muxCodec: 'avc', label: 'H.264 High' },
          { codec: 'avc1.42E01F', muxCodec: 'avc', label: 'H.264 Baseline' },
          { codec: 'hvc1.1.6.L123.B0', muxCodec: 'hevc', label: 'H.265' },
          { codec: 'vp09.00.40.08', muxCodec: 'vp9', label: 'VP9' },
          { codec: 'av01.0.08M.08', muxCodec: 'av1', label: 'AV1' },
        ]
      : [
          { codec: 'vp09.00.40.08', muxCodec: 'V_VP9', label: 'VP9' },
          { codec: 'vp8', muxCodec: 'V_VP8', label: 'VP8' },
          { codec: 'av01.0.08M.08', muxCodec: 'V_AV1', label: 'AV1' },
        ];
  for (const c of candidates) {
    try {
      const cfg: VideoEncoderConfig = { codec: c.codec, width, height, bitrate, framerate: fps };
      if (alpha) cfg.alpha = 'keep';
      const r = await VideoEncoder.isConfigSupported(cfg);
      if (r.supported) return c;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function pickAudioCodec(container: 'mp4' | 'webm'): Promise<{ codec: string; mux: string } | null> {
  if (typeof AudioEncoder === 'undefined') return null;
  const list = container === 'mp4' ? [{ codec: 'mp4a.40.2', mux: 'aac' }, { codec: 'opus', mux: 'opus' }] : [{ codec: 'opus', mux: 'A_OPUS' }];
  for (const c of list) {
    try {
      const r = await AudioEncoder.isConfigSupported({ codec: c.codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 });
      if (r.supported) return c;
    } catch {
      /* next */
    }
  }
  return null;
}

async function exportVideo(s: EditorSession, audio: AudioEngine, o: ExportOptions, onProgress: Progress, token?: CancelToken): Promise<ExportResult> {
  const container = o.format === 'mp4' ? 'mp4' : 'webm';
  const width = even(o.width),
    height = even(o.height);
  const opts = { ...o, width, height };
  const bitrate = videoBitrate(opts);
  const alpha = container === 'webm' && o.transparent;
  let choice = await pickVideoCodec(container, width, height, o.fps, bitrate, alpha);
  let useAlpha = alpha && !!choice;
  if (!choice && alpha) {
    choice = await pickVideoCodec(container, width, height, o.fps, bitrate, false);
    useAlpha = false;
  }
  if (!choice) throw new Error('no-video-encoder');

  // Audio mixdown first (so we know if there is any).
  const indices = resampleIndices(s.doc.frames, s.doc.fps, o.fps, o.from, o.to);
  const starts = frameStarts(s.doc.frames);
  const t0 = starts[o.from] / s.doc.fps;
  const duration = indices.length / o.fps;
  let mixed: AudioBuffer | null = null;
  let audioCodec: { codec: string; mux: string } | null = null;
  if (o.audio && s.doc.audio.some((t) => t.clips.length)) {
    audioCodec = await pickAudioCodec(container);
    if (audioCodec) mixed = await audio.mixdown(s.doc, t0, t0 + duration, 48000);
  }

  const muxMod = container === 'mp4' ? await import('mp4-muxer') : await import('webm-muxer');
  const target = new muxMod.ArrayBufferTarget();
  const muxer = new (muxMod.Muxer as unknown as new (o: unknown) => {
    addVideoChunk(c: EncodedVideoChunk, m?: EncodedVideoChunkMetadata): void;
    addAudioChunk(c: EncodedAudioChunk, m?: EncodedAudioChunkMetadata): void;
    finalize(): void;
  })({
    target,
    video: { codec: choice.muxCodec, width, height, frameRate: o.fps, ...(container === 'webm' && useAlpha ? { alpha: true } : {}) },
    ...(mixed && audioCodec ? { audio: { codec: audioCodec.mux, sampleRate: 48000, numberOfChannels: 2 } } : {}),
    ...(container === 'mp4' ? { fastStart: 'in-memory' } : {}),
    firstTimestampBehavior: 'offset',
  });

  let failure: unknown = null;
  const venc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (failure = e),
  });
  const vcfg: VideoEncoderConfig = { codec: choice.codec, width, height, bitrate, framerate: o.fps, latencyMode: 'quality' };
  if (useAlpha) vcfg.alpha = 'keep';
  if (choice.muxCodec === 'avc') (vcfg as VideoEncoderConfig & { avc?: { format: string } }).avc = { format: 'avc' };
  venc.configure(vcfg);

  const renderer = new FrameRenderer(s, opts);
  const frameUs = 1e6 / o.fps;
  const gop = Math.max(1, Math.round(o.fps * 2));
  try {
    for (let i = 0; i < indices.length; i++) {
      check(token);
      if (failure) throw failure;
      const canvas = await renderer.draw(indices[i], !useAlpha);
      const vf = new VideoFrame(canvas, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs), alpha: useAlpha ? 'keep' : 'discard' } as VideoFrameInit);
      venc.encode(vf, { keyFrame: i % gop === 0 });
      vf.close();
      while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
      onProgress((i + 1) / indices.length * (mixed ? 0.9 : 0.98));
      if (i % 3 === 0) await nextTick();
    }
    await venc.flush();
    if (failure) throw failure;

    if (mixed && audioCodec) {
      const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => (failure = e) });
      aenc.configure({ codec: audioCodec.codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 });
      const L = mixed.getChannelData(0),
        R = mixed.numberOfChannels > 1 ? mixed.getChannelData(1) : mixed.getChannelData(0);
      const block = 4800;
      for (let off = 0; off < mixed.length; off += block) {
        check(token);
        const n = Math.min(block, mixed.length - off);
        const data = new Float32Array(n * 2);
        data.set(L.subarray(off, off + n), 0);
        data.set(R.subarray(off, off + n), n);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((off / 48000) * 1e6), data });
        aenc.encode(ad);
        ad.close();
        if ((off / block) % 20 === 0) await nextTick();
      }
      await aenc.flush();
      aenc.close();
      if (failure) throw failure;
    }
    muxer.finalize();
  } finally {
    if (venc.state !== 'closed') venc.close();
  }
  const mime = container === 'mp4' ? 'video/mp4' : 'video/webm';
  onProgress(1);
  return { blob: new Blob([target.buffer as ArrayBuffer], { type: mime }), name: `${fileBase(s)}.${container}`, mime, codec: choice.label + (mixed ? ` + ${audioCodec!.codec === 'opus' ? 'Opus' : 'AAC'}` : '') };
}

/* ------------------------------- GIF ------------------------------- */

async function exportGif(s: EditorSession, o: ExportOptions, onProgress: Progress, token?: CancelToken): Promise<ExportResult> {
  const worker = new Worker(new URL('./gif.worker.ts', import.meta.url), { type: 'module' });
  const renderer = new FrameRenderer(s, o);
  const ctx = ctx2d(renderer.canvas, { willReadFrequently: true });
  let pendingAck = 0;
  let resolveDone: (b: Uint8Array) => void = () => undefined;
  let rejectDone: (e: unknown) => void = () => undefined;
  const done = new Promise<Uint8Array>((res, rej) => {
    resolveDone = res;
    rejectDone = rej;
  });
  worker.onmessage = (e) => {
    if (e.data.type === 'ack') pendingAck--;
    else if (e.data.type === 'done') resolveDone(e.data.bytes);
    else if (e.data.type === 'error') rejectDone(new Error(e.data.message));
  };
  worker.onerror = (e) => rejectDone(e);
  try {
    worker.postMessage({ type: 'start', width: o.width, height: o.height, loop: o.loop });
    const n = o.to - o.from + 1;
    // Source frames keep their exposure as GIF delay (10 ms resolution).
    for (let i = o.from; i <= o.to; i++) {
      check(token);
      await renderer.draw(i, !o.transparent);
      const data = ctx.getImageData(0, 0, o.width, o.height);
      const delay = Math.max(20, Math.round((s.doc.frames[i].hold * 1000) / s.doc.fps / 10) * 10);
      pendingAck++;
      worker.postMessage({ type: 'frame', rgba: data.data.buffer, delay, transparent: o.transparent }, [data.data.buffer]);
      while (pendingAck > 3) {
        await new Promise((r) => setTimeout(r, 8));
        check(token);
      }
      onProgress(((i - o.from + 1) / n) * 0.97);
    }
    worker.postMessage({ type: 'finish' });
    const bytes = await done;
    onProgress(1);
    return { blob: new Blob([bytes as BlobPart], { type: 'image/gif' }), name: `${fileBase(s)}.gif`, mime: 'image/gif' };
  } finally {
    worker.terminate();
  }
}

/* ------------------------------- PNG ------------------------------- */

async function exportPng(s: EditorSession, o: ExportOptions): Promise<ExportResult> {
  const r = new FrameRenderer(s, o);
  const c = await r.draw(s.frameIndex, !o.transparent);
  return { blob: await canvasToBlob(c, 'image/png'), name: `${fileBase(s)}_${String(s.frameIndex + 1).padStart(4, '0')}.png`, mime: 'image/png' };
}

async function exportPngSequence(s: EditorSession, o: ExportOptions, onProgress: Progress, token?: CancelToken): Promise<ExportResult> {
  const r = new FrameRenderer(s, o);
  const indices = resampleIndices(s.doc.frames, s.doc.fps, o.fps, o.from, o.to);
  const chunks: Uint8Array[] = [];
  let finished: () => void = () => undefined;
  let failed: (e: unknown) => void = () => undefined;
  const done = new Promise<void>((res, rej) => ((finished = res), (failed = rej)));
  const zip = new Zip((err, data, final) => {
    if (err) return failed(err);
    chunks.push(data);
    if (final) finished();
  });
  const base = fileBase(s);
  // Identical consecutive frames (holds) are encoded once.
  let lastIdx = -1;
  let lastPng: Uint8Array | null = null;
  for (let i = 0; i < indices.length; i++) {
    check(token);
    if (indices[i] !== lastIdx) {
      const c = await r.draw(indices[i], !o.transparent);
      lastPng = new Uint8Array(await (await canvasToBlob(c, 'image/png')).arrayBuffer());
      lastIdx = indices[i];
    }
    const f = new ZipPassThrough(`${base}/${base}_${String(i + 1).padStart(5, '0')}.png`);
    zip.add(f);
    f.push(lastPng!, true);
    onProgress((i + 1) / indices.length);
    if (i % 4 === 0) await nextTick();
  }
  zip.end();
  await done;
  return { blob: new Blob(chunks as BlobPart[], { type: 'application/zip' }), name: `${base}_png.zip`, mime: 'application/zip' };
}

export const MAX_SHEET = 16384;

async function exportSpriteSheet(s: EditorSession, o: ExportOptions, onProgress: Progress, token?: CancelToken): Promise<ExportResult> {
  const n = o.to - o.from + 1;
  const cols = Math.max(1, Math.min(n, Math.round(o.columns)));
  const rows = Math.ceil(n / cols);
  if (cols * o.width > MAX_SHEET || rows * o.height > MAX_SHEET) throw new Error('sheet-too-large');
  const sheet = createCanvas(cols * o.width, rows * o.height);
  const sctx = ctx2d(sheet);
  const r = new FrameRenderer(s, o);
  for (let i = 0; i < n; i++) {
    check(token);
    const c = await r.draw(o.from + i, !o.transparent);
    sctx.drawImage(c, (i % cols) * o.width, Math.floor(i / cols) * o.height);
    onProgress(((i + 1) / n) * 0.9);
  }
  const blob = await canvasToBlob(sheet, 'image/png');
  onProgress(1);
  return { blob, name: `${fileBase(s)}_sheet_${cols}x${rows}.png`, mime: 'image/png' };
}

async function exportProjectFile(s: EditorSession, onProgress: Progress): Promise<ExportResult> {
  const { writeProjectFile, PROJECT_EXTENSION, PROJECT_MIME } = await import('../../core/format/projectFile');
  const snap = await s.buildSnapshot();
  const blob = await writeProjectFile(snap, (k) => s.repo.getAsset(s.doc.id, k), null, (d, t) => onProgress(d / Math.max(1, t)));
  return { blob, name: `${s.doc.name.replace(/[\\/:*?"<>|]/g, '_')}${PROJECT_EXTENSION}`, mime: PROJECT_MIME };
}

export function fileBase(s: EditorSession): string {
  const clean = s.doc.name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'animation';
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  return `${clean}_${stamp}`;
}

export async function runExport(s: EditorSession, audio: AudioEngine, o: ExportOptions, onProgress: Progress, token?: CancelToken): Promise<ExportResult> {
  switch (o.format) {
    case 'mp4':
    case 'webm':
      return exportVideo(s, audio, o, onProgress, token);
    case 'gif':
      return exportGif(s, o, onProgress, token);
    case 'png':
      return exportPng(s, o);
    case 'pngseq':
      return exportPngSequence(s, o, onProgress, token);
    case 'spritesheet':
      return exportSpriteSheet(s, o, onProgress, token);
    case 'project':
      return exportProjectFile(s, onProgress);
  }
}

/** Approximate output size in bytes. */
export async function estimateSize(s: EditorSession, o: ExportOptions): Promise<number | null> {
  const frames = o.to - o.from + 1;
  const indices = resampleIndices(s.doc.frames, s.doc.fps, o.fps, o.from, o.to);
  const duration = indices.length / o.fps;
  const hasAudio = o.audio && s.doc.audio.some((t) => t.clips.length);
  switch (o.format) {
    case 'mp4':
    case 'webm':
      // Hand-drawn animation compresses well: ~45 % of the target bitrate on average.
      return (videoBitrate({ ...o, width: even(o.width), height: even(o.height) }) * duration * 0.45) / 8 + (hasAudio ? (160000 * duration) / 8 : 0);
    case 'png':
    case 'pngseq':
    case 'spritesheet': {
      const r = new FrameRenderer(s, o);
      const c = await r.draw(Math.min(o.to, Math.max(o.from, s.frameIndex)), !o.transparent);
      const one = (await canvasToBlob(c, 'image/png')).size;
      if (o.format === 'png') return one;
      if (o.format === 'spritesheet') return one * frames * 0.9;
      const unique = new Set(indices).size;
      return one * unique + (indices.length - unique) * one;
    }
    case 'gif': {
      // GIF ≈ 0.35 byte / pixel / frame for flat-coloured drawings.
      return o.width * o.height * frames * 0.35;
    }
    case 'project':
      return null;
  }
}
