import { referencedKeys, validateSavedProject, metaOf } from '../core/model/project';
import type { ProjectMeta, SavedProject } from '../core/model/types';
import { Db, reqToPromise, txDone } from './db';

interface DocRow {
  key: string;
  projectId: string;
  rev: number;
  savedAt: number;
  doc: SavedProject;
}

interface BlobRow {
  key: string;
  projectId: string;
  assetKey: string;
  blob: Blob;
}

export interface RecoveryRow {
  projectId: string;
  savedAt: number;
  baseRev: number;
  doc: SavedProject;
  dismissed: boolean;
}

export interface RevisionInfo {
  rev: number;
  savedAt: number;
  frameCount: number;
  layerCount: number;
}

const docKey = (projectId: string, rev: number) => `${projectId}:${String(rev).padStart(8, '0')}`;
const blobKey = (projectId: string, assetKey: string) => `${projectId}/${assetKey}`;
export const TRASH_RETENTION_MS = 30 * 24 * 3600 * 1000;

/**
 * Persistent project storage.
 *
 * - Assets (cel PNGs, audio, reference images, thumbnails) are immutable blobs.
 * - Each manual save writes a new *revision* of the document; the last N are
 *   kept, which provides version history for free because they share blobs.
 * - Autosave writes a *recovery* document that never overwrites the saved
 *   project; it is offered back after a crash.
 * - Saves are crash-safe: blobs are written first, then the document and the
 *   metadata are committed in a single transaction.
 */
export class ProjectRepository {
  constructor(readonly db: Db) {}

  async list(): Promise<ProjectMeta[]> {
    const all = await this.db.getAll<ProjectMeta>('meta');
    return all.filter((m) => !m.deletedAt).sort((a, b) => b.modifiedAt - a.modifiedAt);
  }

  async listTrash(): Promise<ProjectMeta[]> {
    const all = await this.db.getAll<ProjectMeta>('meta');
    return all.filter((m) => !!m.deletedAt).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
  }

  getMeta(id: string): Promise<ProjectMeta | undefined> {
    return this.db.get<ProjectMeta>('meta', id);
  }

  async listRevisions(projectId: string): Promise<RevisionInfo[]> {
    const rows = await this.db.getAllByProject<DocRow>('docs', projectId);
    return rows
      .map((r) => ({ rev: r.rev, savedAt: r.savedAt, frameCount: r.doc.frames.length, layerCount: r.doc.layers.length }))
      .sort((a, b) => b.rev - a.rev);
  }

  /** Load a revision (latest by default). The document is re-validated. */
  async load(projectId: string, rev?: number): Promise<{ doc: SavedProject; rev: number }> {
    const meta = await this.getMeta(projectId);
    if (!meta) throw new Error('project-not-found');
    const r = rev ?? meta.rev;
    const row = await this.db.get<DocRow>('docs', docKey(projectId, r));
    if (!row) throw new Error('revision-not-found');
    return { doc: validateSavedProject(row.doc), rev: r };
  }

  async putAsset(projectId: string, assetKey: string, blob: Blob): Promise<void> {
    await this.db.put('blobs', { key: blobKey(projectId, assetKey), projectId, assetKey, blob } satisfies BlobRow);
  }

  /** Write several assets in one transaction. */
  async putAssets(projectId: string, assets: { key: string; blob: Blob }[]): Promise<void> {
    if (!assets.length) return;
    const tx = this.db.tx('blobs', 'readwrite');
    const store = tx.objectStore('blobs');
    for (const a of assets) store.put({ key: blobKey(projectId, a.key), projectId, assetKey: a.key, blob: a.blob } satisfies BlobRow);
    await txDone(tx);
  }

  async getAsset(projectId: string, assetKey: string): Promise<Blob | null> {
    const row = await this.db.get<BlobRow>('blobs', blobKey(projectId, assetKey));
    return row?.blob ?? null;
  }

  async hasAsset(projectId: string, assetKey: string): Promise<boolean> {
    const tx = this.db.tx('blobs');
    const n = await reqToPromise(tx.objectStore('blobs').count(blobKey(projectId, assetKey)));
    return n > 0;
  }

  /**
   * Commit a saved document as a new revision. All assets referenced by the
   * document must have been written before (see putAssets).
   */
  async commit(doc: SavedProject, thumbKey: string | null, keepVersions = 10): Promise<number> {
    const tx = this.db.tx(['meta', 'docs', 'recovery'], 'readwrite');
    const metaStore = tx.objectStore('meta');
    const docs = tx.objectStore('docs');
    const prev = (await reqToPromise(metaStore.get(doc.id))) as ProjectMeta | undefined;
    const rev = (prev?.rev ?? 0) + 1;
    const now = Date.now();
    docs.put({ key: docKey(doc.id, rev), projectId: doc.id, rev, savedAt: now, doc } satisfies DocRow);
    const meta = metaOf(doc, rev, thumbKey ?? prev?.thumbKey ?? null);
    meta.createdAt = prev?.createdAt ?? doc.createdAt;
    metaStore.put(meta);
    tx.objectStore('recovery').delete(doc.id);
    // Drop revisions beyond the retention window (keys sort by revision).
    const keys = (await reqToPromise(docs.index('byProject').getAllKeys(doc.id))) as string[];
    keys.sort();
    const excess = keys.length - Math.max(1, keepVersions);
    for (let i = 0; i < excess; i++) docs.delete(keys[i]);
    await txDone(tx);
    return rev;
  }

  async rename(projectId: string, name: string): Promise<void> {
    const tx = this.db.tx(['meta', 'docs'], 'readwrite');
    const meta = (await reqToPromise(tx.objectStore('meta').get(projectId))) as ProjectMeta | undefined;
    if (!meta) throw new Error('project-not-found');
    meta.name = name;
    tx.objectStore('meta').put(meta);
    const k = docKey(projectId, meta.rev);
    const row = (await reqToPromise(tx.objectStore('docs').get(k))) as DocRow | undefined;
    if (row) {
      row.doc.name = name;
      tx.objectStore('docs').put(row);
    }
    await txDone(tx);
  }

  /* ----------------------------- Recovery ----------------------------- */

  async saveRecovery(doc: SavedProject, baseRev: number): Promise<void> {
    await this.db.put('recovery', { projectId: doc.id, savedAt: Date.now(), baseRev, doc, dismissed: false } satisfies RecoveryRow);
  }

  getRecovery(projectId: string): Promise<RecoveryRow | undefined> {
    return this.db.get<RecoveryRow>('recovery', projectId);
  }

  listRecoveries(): Promise<RecoveryRow[]> {
    return this.db.getAll<RecoveryRow>('recovery');
  }

  async dismissRecovery(projectId: string): Promise<void> {
    const row = await this.getRecovery(projectId);
    if (row) await this.db.put('recovery', { ...row, dismissed: true });
  }

  async deleteRecovery(projectId: string): Promise<void> {
    await this.db.delete('recovery', projectId);
    await this.gc(projectId);
  }

  /** Write a meta row for a project that only exists as a recovery copy (never saved). */
  async ensureMetaForRecovery(doc: SavedProject): Promise<void> {
    if (await this.getMeta(doc.id)) return;
    const meta = metaOf(doc, 0, null);
    await this.db.put('meta', meta);
  }

  /* ------------------------------- Trash ------------------------------ */

  async trash(projectId: string): Promise<void> {
    const meta = await this.getMeta(projectId);
    if (!meta) return;
    await this.db.put('meta', { ...meta, deletedAt: Date.now() });
  }

  async restore(projectId: string): Promise<void> {
    const meta = await this.getMeta(projectId);
    if (!meta) return;
    await this.db.put('meta', { ...meta, deletedAt: null });
  }

  async deletePermanently(projectId: string): Promise<void> {
    const docKeys = await this.db.keysByProject('docs', projectId);
    const blobKeys = await this.db.keysByProject('blobs', projectId);
    const tx = this.db.tx(['meta', 'docs', 'blobs', 'recovery'], 'readwrite');
    tx.objectStore('meta').delete(projectId);
    tx.objectStore('recovery').delete(projectId);
    for (const k of docKeys) tx.objectStore('docs').delete(k);
    for (const k of blobKeys) tx.objectStore('blobs').delete(k);
    await txDone(tx);
  }

  async purgeTrash(olderThanMs = TRASH_RETENTION_MS): Promise<number> {
    const now = Date.now();
    const old = (await this.listTrash()).filter((m) => now - (m.deletedAt ?? now) >= olderThanMs);
    for (const m of old) await this.deletePermanently(m.id);
    return old.length;
  }

  /* ----------------------------- Utilities ---------------------------- */

  /** Copy a project (latest revision + its assets) under a new id. */
  async duplicate(projectId: string, newId: string, newName: string): Promise<void> {
    const { doc } = await this.load(projectId);
    const keys = referencedKeys(doc);
    const meta = await this.getMeta(projectId);
    if (meta?.thumbKey) keys.add(meta.thumbKey);
    const assets: { key: string; blob: Blob }[] = [];
    for (const k of keys) {
      const b = await this.getAsset(projectId, k);
      if (b) assets.push({ key: k, blob: b });
    }
    await this.putAssets(newId, assets);
    const now = Date.now();
    await this.commit({ ...doc, id: newId, name: newName, createdAt: now, modifiedAt: now }, meta?.thumbKey ?? null, 10);
  }

  /** Delete assets that no revision / recovery / thumbnail references anymore. */
  async gc(projectId: string, extraKeep: Iterable<string> = []): Promise<number> {
    const keep = new Set<string>(extraKeep);
    const docs = await this.db.getAllByProject<DocRow>('docs', projectId);
    for (const row of docs) for (const k of referencedKeys(row.doc)) keep.add(k);
    const rec = await this.getRecovery(projectId);
    if (rec) for (const k of referencedKeys(rec.doc)) keep.add(k);
    const meta = await this.getMeta(projectId);
    if (meta?.thumbKey) keep.add(meta.thumbKey);
    const keys = await this.db.keysByProject('blobs', projectId);
    const prefix = projectId + '/';
    const dead = keys.filter((k) => !keep.has(k.slice(prefix.length)));
    if (dead.length) {
      const tx = this.db.tx('blobs', 'readwrite');
      for (const k of dead) tx.objectStore('blobs').delete(k);
      await txDone(tx);
    }
    return dead.length;
  }

  async kvGet<T>(key: string): Promise<T | undefined> {
    return this.db.get<T>('kv', key);
  }

  async kvSet(key: string, value: unknown): Promise<void> {
    await this.db.put('kv', value, key);
  }
}
