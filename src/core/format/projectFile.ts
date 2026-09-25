/**
 * Native project file (.frameloom): a ZIP archive.
 *
 *   project.json            SavedProject (validated on import)
 *   manifest.json           { app, formatVersion, exportedAt, assets: { key: { path, mime } } }
 *   cels/<key>.png          one PNG per non-empty cel (cropped, see CelRecord)
 *   audio/<key>.<ext>       original audio files
 *   references/<key>.<ext>  reference images
 *   thumbnail.png           cover image (optional)
 *
 * Binary assets are stored without re-compression (they are already
 * compressed); JSON is deflated.
 */
import { Zip, ZipDeflate, ZipPassThrough, unzipSync, strToU8, strFromU8 } from 'fflate';
import { FORMAT_VERSION, type SavedProject } from '../model/types';
import { ProjectFormatError, validateSavedProject } from '../model/project';

export const PROJECT_EXTENSION = '.frameloom';
export const PROJECT_MIME = 'application/x-frameloom';
/** Refuse archives that would expand beyond this (zip-bomb protection). */
export const MAX_UNCOMPRESSED = 3 * 1024 * 1024 * 1024;
const MAX_ENTRIES = 200_000;

interface ManifestAsset {
  path: string;
  mime: string;
}
interface Manifest {
  app: string;
  formatVersion: number;
  exportedAt: number;
  assets: Record<string, ManifestAsset>;
}

const EXT: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
};
const extFor = (mime: string) => EXT[mime] ?? 'bin';

export type AssetGetter = (key: string) => Promise<Blob | null>;

export interface ExportProgress {
  (done: number, total: number): void;
}

/** Build the archive. Missing assets are skipped (the cel then loads as empty). */
export async function writeProjectFile(
  doc: SavedProject,
  getAsset: AssetGetter,
  thumbnail?: Blob | null,
  onProgress?: ExportProgress,
): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  let finished: () => void = () => undefined;
  let failed: (e: unknown) => void = () => undefined;
  const done = new Promise<void>((res, rej) => {
    finished = res;
    failed = rej;
  });
  const zip = new Zip((err, data, final) => {
    if (err) return failed(err);
    chunks.push(data);
    if (final) finished();
  });

  const manifest: Manifest = { app: 'Frameloom', formatVersion: FORMAT_VERSION, exportedAt: Date.now(), assets: {} };
  const entries: { key: string; path: string; mime: string }[] = [];
  for (const c of Object.values(doc.cels)) if (c.key) entries.push({ key: c.key, path: `cels/${c.key}.png`, mime: 'image/png' });
  for (const t of doc.audio) for (const c of t.clips) entries.push({ key: c.assetKey, path: `audio/${c.assetKey}.${extFor(c.mime)}`, mime: c.mime });
  for (const r of doc.references) entries.push({ key: r.assetKey, path: `references/${r.assetKey}.${extFor(r.mime)}`, mime: r.mime });

  const seen = new Set<string>();
  let i = 0;
  for (const e of entries) {
    i++;
    if (seen.has(e.key)) continue;
    seen.add(e.key);
    const blob = await getAsset(e.key);
    if (!blob) continue;
    const f = new ZipPassThrough(e.path);
    zip.add(f);
    f.push(new Uint8Array(await blob.arrayBuffer()), true);
    manifest.assets[e.key] = { path: e.path, mime: e.mime };
    onProgress?.(i, entries.length);
  }
  if (thumbnail) {
    const f = new ZipPassThrough('thumbnail.png');
    zip.add(f);
    f.push(new Uint8Array(await thumbnail.arrayBuffer()), true);
  }
  for (const [name, value] of [
    ['project.json', doc],
    ['manifest.json', manifest],
  ] as const) {
    const f = new ZipDeflate(name, { level: 6 });
    zip.add(f);
    f.push(strToU8(JSON.stringify(value)), true);
  }
  zip.end();
  await done;
  return new Blob(chunks as BlobPart[], { type: PROJECT_MIME });
}

export interface ReadProjectResult {
  doc: SavedProject;
  assets: Map<string, Blob>;
  thumbnail: Blob | null;
  missingAssets: string[];
}

/** Parse and validate an archive. Throws ProjectFormatError on invalid input. */
export async function readProjectFile(file: Blob): Promise<ReadProjectResult> {
  let files: Record<string, Uint8Array>;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    let total = 0;
    let count = 0;
    files = unzipSync(buf, {
      filter: (f) => {
        count++;
        total += f.originalSize;
        if (count > MAX_ENTRIES || total > MAX_UNCOMPRESSED) throw new ProjectFormatError('archive-too-large');
        // Only extract the paths we understand; never trust arbitrary names.
        return /^(project\.json|manifest\.json|thumbnail\.png|(cels|audio|references)\/[A-Za-z0-9_.-]{1,140})$/.test(f.name);
      },
    });
  } catch (e) {
    if (e instanceof ProjectFormatError) throw e;
    throw new ProjectFormatError('not-a-zip');
  }
  if (!files['project.json']) throw new ProjectFormatError('missing-project-json');
  let json: unknown;
  try {
    json = JSON.parse(strFromU8(files['project.json']));
  } catch {
    throw new ProjectFormatError('invalid-json');
  }
  const doc = validateSavedProject(json);

  let manifest: Manifest | null = null;
  try {
    if (files['manifest.json']) manifest = JSON.parse(strFromU8(files['manifest.json'])) as Manifest;
  } catch {
    manifest = null;
  }

  const byBase = new Map<string, { path: string; data: Uint8Array }>();
  for (const [path, data] of Object.entries(files)) {
    const m = /^(cels|audio|references)\/(.+)$/.exec(path);
    if (!m) continue;
    const base = m[2].replace(/\.[A-Za-z0-9]{1,5}$/, '');
    byBase.set(`${m[1]}/${base}`, { path, data });
  }
  const assets = new Map<string, Blob>();
  const missing: string[] = [];
  const want = (folder: string, key: string, mime: string) => {
    const hit = (manifest?.assets?.[key] && files[manifest.assets[key].path] && { data: files[manifest.assets[key].path] }) || byBase.get(`${folder}/${key}`);
    if (hit) assets.set(key, new Blob([hit.data as BlobPart], { type: mime }));
    else missing.push(key);
  };
  for (const c of Object.values(doc.cels)) if (c.key) want('cels', c.key, 'image/png');
  for (const t of doc.audio) for (const c of t.clips) want('audio', c.assetKey, c.mime);
  for (const r of doc.references) want('references', r.assetKey, r.mime);

  // Cels whose image is missing become empty rather than failing the import.
  for (const c of Object.values(doc.cels)) if (c.key && !assets.has(c.key)) c.key = null;
  for (const t of doc.audio) t.clips = t.clips.filter((c) => assets.has(c.assetKey));
  doc.references = doc.references.filter((r) => assets.has(r.assetKey));

  const thumbnail = files['thumbnail.png'] ? new Blob([files['thumbnail.png'] as BlobPart], { type: 'image/png' }) : null;
  return { doc, assets, thumbnail, missingAssets: missing };
}
