import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { Db } from '../../src/storage/db';
import { ProjectRepository } from '../../src/storage/ProjectRepository';
import { createProject } from '../../src/core/model/project';
import { FORMAT_ID, FORMAT_VERSION, type SavedProject } from '../../src/core/model/types';
import { writeProjectFile, readProjectFile } from '../../src/core/format/projectFile';
import { ProjectFormatError } from '../../src/core/model/project';
import { zipSync, strToU8 } from 'fflate';

function makeDoc(frames = 3): SavedProject {
  const p = createProject({ name: 'Anim', width: 64, height: 48, fps: 12, frameCount: frames, background: '#ffffff', transparent: false });
  return { ...p, format: FORMAT_ID, formatVersion: FORMAT_VERSION, cels: {} };
}

function withCel(doc: SavedProject, frame: number, celId: string, key: string): SavedProject {
  const d = structuredClone(doc);
  d.frames[frame].cels[d.layers[0].id] = celId;
  d.cels[celId] = { key, x: 1, y: 2, w: 3, h: 4 };
  return d;
}

const png = (s: string) => new Blob([s], { type: 'image/png' });

let repo: ProjectRepository;
beforeEach(async () => {
  repo = new ProjectRepository(await Db.open(new IDBFactory()));
});

describe('ProjectRepository', () => {
  it('saves and reloads a project with its assets', async () => {
    const doc = withCel(makeDoc(), 0, 'c1', 'a1');
    await repo.putAssets(doc.id, [{ key: 'a1', blob: png('pixels') }]);
    const rev = await repo.commit(doc, null);
    expect(rev).toBe(1);
    const loaded = await repo.load(doc.id);
    expect(loaded.doc.frames[0].cels[doc.layers[0].id]).toBe('c1');
    expect(await (await repo.getAsset(doc.id, 'a1'))!.text()).toBe('pixels');
    const list = await repo.list();
    expect(list[0]).toMatchObject({ id: doc.id, frameCount: 3, width: 64, height: 48, fps: 12, rev: 1 });
  });

  it('keeps a bounded number of versions and can open an older one', async () => {
    let doc = makeDoc();
    for (let i = 0; i < 5; i++) {
      doc = { ...doc, name: 'v' + i };
      await repo.commit(doc, null, 3);
    }
    const revs = await repo.listRevisions(doc.id);
    expect(revs.map((r) => r.rev)).toEqual([5, 4, 3]);
    expect((await repo.load(doc.id, 3)).doc.name).toBe('v2');
    await expect(repo.load(doc.id, 1)).rejects.toThrow();
  });

  it('keeps the previous version intact when a save is interrupted', async () => {
    const v1 = withCel(makeDoc(), 0, 'c1', 'a1');
    await repo.putAssets(v1.id, [{ key: 'a1', blob: png('one') }]);
    await repo.commit(v1, null);
    // Simulated crash: new assets written, but the document commit never happens.
    await repo.putAssets(v1.id, [{ key: 'a2', blob: png('two') }]);
    const loaded = await repo.load(v1.id);
    expect(loaded.rev).toBe(1);
    expect(loaded.doc.cels.c1.key).toBe('a1');
    // Orphans are collected afterwards.
    expect(await repo.gc(v1.id)).toBe(1);
    expect(await repo.hasAsset(v1.id, 'a1')).toBe(true);
    expect(await repo.hasAsset(v1.id, 'a2')).toBe(false);
  });

  it('stores recovery copies separately and clears them on save', async () => {
    const doc = makeDoc();
    await repo.commit(doc, null);
    const edited = { ...doc, name: 'unsaved work' };
    await repo.saveRecovery(edited, 1);
    expect((await repo.load(doc.id)).doc.name).toBe('Anim'); // saved project untouched
    const rec = await repo.listRecoveries();
    expect(rec).toHaveLength(1);
    expect(rec[0].doc.name).toBe('unsaved work');
    await repo.dismissRecovery(doc.id);
    expect((await repo.getRecovery(doc.id))!.dismissed).toBe(true);
    await repo.commit(edited, null);
    expect(await repo.listRecoveries()).toHaveLength(0);
  });

  it('gc keeps assets referenced by recovery and older revisions', async () => {
    const d1 = withCel(makeDoc(), 0, 'c1', 'a1');
    await repo.putAssets(d1.id, [{ key: 'a1', blob: png('1') }, { key: 'a2', blob: png('2') }, { key: 'a3', blob: png('3') }]);
    await repo.commit(d1, null);
    await repo.saveRecovery(withCel(d1, 1, 'c2', 'a2'), 1);
    expect(await repo.gc(d1.id)).toBe(1);
    expect(await repo.hasAsset(d1.id, 'a2')).toBe(true);
    await repo.deleteRecovery(d1.id);
    expect(await repo.hasAsset(d1.id, 'a2')).toBe(false);
  });

  it('moves projects to the trash, restores and deletes them', async () => {
    const doc = makeDoc();
    await repo.putAssets(doc.id, [{ key: 'a', blob: png('x') }]);
    await repo.commit(doc, null);
    await repo.trash(doc.id);
    expect(await repo.list()).toHaveLength(0);
    expect(await repo.listTrash()).toHaveLength(1);
    await repo.restore(doc.id);
    expect(await repo.list()).toHaveLength(1);
    await repo.trash(doc.id);
    expect(await repo.purgeTrash(0)).toBe(1);
    expect(await repo.listTrash()).toHaveLength(0);
    expect(await repo.hasAsset(doc.id, 'a')).toBe(false);
  });

  it('duplicates and renames', async () => {
    const doc = withCel(makeDoc(), 0, 'c1', 'a1');
    await repo.putAssets(doc.id, [{ key: 'a1', blob: png('p') }]);
    await repo.commit(doc, null);
    await repo.duplicate(doc.id, 'pcopy', 'Copie');
    await repo.rename(doc.id, 'Renamed');
    const list = await repo.list();
    expect(list.map((m) => m.name).sort()).toEqual(['Copie', 'Renamed']);
    expect(await repo.hasAsset('pcopy', 'a1')).toBe(true);
    expect((await repo.load(doc.id)).doc.name).toBe('Renamed');
  });

  it('handles a project with hundreds of frames and several layers', async () => {
    const doc = makeDoc(600);
    for (let i = 0; i < 600; i++) {
      doc.frames[i].cels[doc.layers[0].id] = 'c' + i;
      doc.cels['c' + i] = { key: 'k' + i, x: 0, y: 0, w: 1, h: 1 };
    }
    await repo.putAssets(doc.id, doc.frames.map((_, i) => ({ key: 'k' + i, blob: png(String(i)) })));
    await repo.commit(doc, null);
    const { doc: back } = await repo.load(doc.id);
    expect(back.frames).toHaveLength(600);
    expect(Object.keys(back.cels)).toHaveLength(600);
  });
});

describe('.frameloom project files', () => {
  it('round-trips a project with cels, audio and references', async () => {
    const doc = withCel(makeDoc(), 1, 'c1', 'a1');
    doc.audio.push({ id: 't', name: 'Piste', volume: 1, muted: false, clips: [{ id: 'ac', name: 'son.mp3', assetKey: 'snd', mime: 'audio/mpeg', start: 0, offset: 0, duration: 1, sourceDuration: 1, volume: 1, muted: false }] });
    doc.references.push({ id: 'r', name: 'ref', assetKey: 'refimg', mime: 'image/jpeg', naturalWidth: 10, naturalHeight: 10, x: 5, y: 5, scale: 1, rotation: 0, opacity: 0.5, visible: true, locked: false, placement: 'below', exportable: false });
    const assets: Record<string, Blob> = { a1: png('cel'), snd: new Blob(['mp3'], { type: 'audio/mpeg' }), refimg: new Blob(['jpg'], { type: 'image/jpeg' }) };
    const file = await writeProjectFile(doc, async (k) => assets[k] ?? null, png('thumb'));
    const back = await readProjectFile(file);
    expect(back.doc.frames[1].cels[doc.layers[0].id]).toBe('c1');
    expect(await back.assets.get('a1')!.text()).toBe('cel');
    expect(await back.assets.get('snd')!.text()).toBe('mp3');
    expect(back.doc.audio[0].clips).toHaveLength(1);
    expect(back.doc.references).toHaveLength(1);
    expect(back.thumbnail).not.toBeNull();
    expect(back.missingAssets).toEqual([]);
  });

  it('turns cels with missing images into empty cels', async () => {
    const doc = withCel(makeDoc(), 0, 'c1', 'gone');
    const back = await readProjectFile(await writeProjectFile(doc, async () => null));
    expect(back.doc.cels.c1.key).toBeNull();
    expect(back.missingAssets).toEqual(['gone']);
  });

  it('rejects corrupted files with a typed error', async () => {
    await expect(readProjectFile(new Blob(['not a zip at all']))).rejects.toBeInstanceOf(ProjectFormatError);
    const noJson = new Blob([zipSync({ 'hello.txt': strToU8('hi') }) as BlobPart]);
    await expect(readProjectFile(noJson)).rejects.toThrow('missing-project-json');
    const badJson = new Blob([zipSync({ 'project.json': strToU8('{oops') }) as BlobPart]);
    await expect(readProjectFile(badJson)).rejects.toThrow('invalid-json');
    const wrong = new Blob([zipSync({ 'project.json': strToU8('{"format":"other"}') }) as BlobPart]);
    await expect(readProjectFile(wrong)).rejects.toThrow('bad-format-id');
  });

  it('ignores unexpected paths inside the archive', async () => {
    const doc = makeDoc();
    const z = zipSync({ 'project.json': strToU8(JSON.stringify(doc)), '../../evil.sh': strToU8('rm -rf'), 'cels/../x.png': strToU8('x') });
    const back = await readProjectFile(new Blob([z as BlobPart]));
    expect(back.assets.size).toBe(0);
  });
});
