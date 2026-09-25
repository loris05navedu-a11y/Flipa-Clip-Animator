import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/** Native helper implemented in android/app/src/main/java/.../FilesPlugin.java */
interface FilesPlugin {
  saveAs(opts: { path: string; name: string; mime: string }): Promise<{ saved: boolean }>;
  saveToGallery(opts: { path: string; name: string; mime: string }): Promise<{ saved: boolean }>;
}
const Files = registerPlugin<FilesPlugin>('FrameloomFiles');

export const isNative = (): boolean => Capacitor.isNativePlatform();
export const platformName = (): string => Capacitor.getPlatform();

/** Write a blob to the app cache in chunks (the bridge only carries base64 strings). */
async function writeCache(blob: Blob, name: string): Promise<string> {
  const safeName = name.replace(/[^\w.\- ()]/g, '_');
  const path = `exports/${Date.now()}_${safeName}`;
  const CHUNK = 3 * 1024 * 1024; // multiple of 3 so base64 chunks concatenate cleanly
  let first = true;
  for (let off = 0; off < blob.size || first; off += CHUNK) {
    const part = blob.slice(off, off + CHUNK);
    const b64 = await blobToBase64(part);
    if (first) await Filesystem.writeFile({ path, data: b64, directory: Directory.Cache, recursive: true });
    else await Filesystem.appendFile({ path, data: b64, directory: Directory.Cache });
    first = false;
    if (blob.size === 0) break;
  }
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  return uri;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** "Save as…": system document picker on Android, download on the web. */
export async function saveFile(blob: Blob, name: string, mime: string): Promise<boolean> {
  if (!isNative()) {
    download(blob, name);
    return true;
  }
  const uri = await writeCache(blob, name);
  const r = await Files.saveAs({ path: uri, name, mime });
  return r.saved;
}

export const canShare = (): boolean => isNative() || typeof navigator.share === 'function';

export async function shareFile(blob: Blob, name: string, mime: string): Promise<void> {
  if (isNative()) {
    const uri = await writeCache(blob, name);
    await Share.share({ files: [uri], title: name });
    return;
  }
  const file = new File([blob], name, { type: mime });
  if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: name });
  else download(blob, name);
}

/** Gallery (MediaStore) export is only available in the Android app. */
export const canSaveToGallery = (): boolean => isNative();

export async function saveToGallery(blob: Blob, name: string, mime: string): Promise<boolean> {
  const uri = await writeCache(blob, name);
  const r = await Files.saveToGallery({ path: uri, name, mime });
  return r.saved;
}

/** Open the system file picker. */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.onchange = () => finish(input.files ? [...input.files] : []);
    input.addEventListener('cancel', () => finish([]));
    document.body.appendChild(input);
    input.click();
  });
}

/** Clean exported copies left in the cache. */
export async function clearExportCache(): Promise<number> {
  if (!isNative()) return 0;
  try {
    const { files } = await Filesystem.readdir({ path: 'exports', directory: Directory.Cache });
    await Filesystem.rmdir({ path: 'exports', directory: Directory.Cache, recursive: true });
    return files.length;
  } catch {
    return 0;
  }
}
