import { Db } from '../storage/db';
import { ProjectRepository } from '../storage/ProjectRepository';

let repoPromise: Promise<ProjectRepository> | null = null;

/** The single repository instance (opened lazily). */
export function getRepo(): Promise<ProjectRepository> {
  if (!repoPromise) {
    repoPromise = Db.open().then((db) => new ProjectRepository(db));
    repoPromise.catch(() => (repoPromise = null));
  }
  return repoPromise;
}

/** Ask the browser/WebView not to evict our storage under pressure. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { usage: e.usage ?? 0, quota: e.quota ?? 0 } : null;
  } catch {
    return null;
  }
}
