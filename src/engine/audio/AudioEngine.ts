import type { AudioClipDef, ProjectData } from '../../core/model/types';

export interface AssetLoader {
  getAsset(key: string): Promise<Blob | null>;
}

/**
 * Audio decoding, waveform peaks, synchronised playback and offline mixdown
 * (used by video export). Uses the Web Audio API (hardware-accelerated in the
 * Android WebView). Formats: whatever the device decodes natively
 * (MP3, WAV, AAC/M4A, OGG/Opus, FLAC on current Android versions).
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private peaks = new Map<string, Float32Array>();
  private playing: { src: AudioBufferSourceNode; gain: GainNode }[] = [];
  private master: GainNode | null = null;

  constructor(private assets: AssetLoader) {}

  private context(): AudioContext {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /** Decode (once) an audio asset. */
  buffer(assetKey: string): Promise<AudioBuffer> {
    let p = this.buffers.get(assetKey);
    if (!p) {
      p = (async () => {
        const blob = await this.assets.getAsset(assetKey);
        if (!blob) throw new Error('missing-audio');
        return decodeAudio(await blob.arrayBuffer(), this.context());
      })();
      this.buffers.set(assetKey, p);
      p.catch(() => this.buffers.delete(assetKey));
    }
    return p;
  }

  /** Register an already-decoded buffer (import). */
  prime(assetKey: string, buf: AudioBuffer): void {
    this.buffers.set(assetKey, Promise.resolve(buf));
  }

  /** Min/max peaks (2 values per bucket) for waveform display, cached per asset. */
  async waveform(assetKey: string): Promise<Float32Array> {
    const hit = this.peaks.get(assetKey);
    if (hit) return hit;
    const buf = await this.buffer(assetKey);
    const p = computePeaks(buf, Math.min(8000, Math.max(200, Math.round(buf.duration * 200))));
    this.peaks.set(assetKey, p);
    return p;
  }

  get isPlaying(): boolean {
    return this.playing.length > 0;
  }

  /** Start every clip that overlaps [from, …) at the given playback rate. */
  async play(doc: ProjectData, from: number, rate = 1): Promise<void> {
    this.stop();
    const ctx = this.context();
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
    const now = ctx.currentTime + 0.03;
    for (const track of doc.audio) {
      if (track.muted) continue;
      for (const clip of track.clips) {
        if (clip.muted || clip.start + clip.duration <= from) continue;
        let buf: AudioBuffer;
        try {
          buf = await this.buffer(clip.assetKey);
        } catch {
          continue;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = rate;
        const gain = ctx.createGain();
        gain.gain.value = clip.volume * track.volume;
        src.connect(gain).connect(this.master!);
        const skip = Math.max(0, from - clip.start);
        const when = now + Math.max(0, clip.start - from) / rate;
        src.start(when, clip.offset + skip, Math.max(0, clip.duration - skip));
        this.playing.push({ src, gain });
      }
    }
  }

  /** Play a single clip (preview button). */
  async preview(clip: AudioClipDef): Promise<void> {
    this.stop();
    const ctx = this.context();
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
    const buf = await this.buffer(clip.assetKey);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = clip.volume;
    src.connect(gain).connect(this.master!);
    src.start(ctx.currentTime, clip.offset, clip.duration);
    this.playing.push({ src, gain });
  }

  stop(): void {
    for (const p of this.playing) {
      try {
        p.src.stop();
      } catch {
        /* already stopped */
      }
      p.src.disconnect();
      p.gain.disconnect();
    }
    this.playing = [];
  }

  /** Render the project audio between two times into a stereo buffer. */
  async mixdown(doc: ProjectData, from: number, to: number, sampleRate = 48000): Promise<AudioBuffer | null> {
    const clips = doc.audio.flatMap((t) => (t.muted ? [] : t.clips.filter((c) => !c.muted && c.start < to && c.start + c.duration > from).map((c) => ({ c, vol: t.volume }))));
    if (!clips.length) return null;
    const length = Math.max(1, Math.ceil((to - from) * sampleRate));
    const off = new OfflineAudioContext(2, length, sampleRate);
    for (const { c, vol } of clips) {
      let buf: AudioBuffer;
      try {
        buf = await this.buffer(c.assetKey);
      } catch {
        continue;
      }
      const src = off.createBufferSource();
      src.buffer = buf;
      const g = off.createGain();
      g.gain.value = c.volume * vol;
      src.connect(g).connect(off.destination);
      const skip = Math.max(0, from - c.start);
      src.start(Math.max(0, c.start - from), c.offset + skip, Math.max(0, c.duration - skip));
    }
    return off.startRendering();
  }

  dispose(): void {
    this.stop();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.buffers.clear();
    this.peaks.clear();
  }
}

export function decodeAudio(data: ArrayBuffer, ctx?: BaseAudioContext): Promise<AudioBuffer> {
  const c = ctx ?? new OfflineAudioContext(1, 1, 44100);
  return new Promise((resolve, reject) => {
    const p = c.decodeAudioData(data, resolve, (e) => reject(e ?? new Error('audio-decode')));
    if (p && typeof (p as Promise<AudioBuffer>).catch === 'function') (p as Promise<AudioBuffer>).catch(reject);
  });
}

export function computePeaks(buf: AudioBuffer, buckets: number): Float32Array {
  const out = new Float32Array(buckets * 2);
  const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  const per = buf.length / buckets;
  for (let b = 0; b < buckets; b++) {
    let min = 1,
      max = -1;
    const s0 = Math.floor(b * per),
      s1 = Math.min(buf.length, Math.floor((b + 1) * per));
    const step = Math.max(1, Math.floor((s1 - s0) / 256));
    for (let i = s0; i < s1; i += step) {
      for (const ch of chans) {
        const v = ch[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    out[b * 2] = min > max ? 0 : min;
    out[b * 2 + 1] = min > max ? 0 : max;
  }
  return out;
}
