import { Copy, Download, FileArchive, FileImage, FileVideo, FolderOpen, History, Images, MoreVertical, Pencil, Plus, Search, Settings, CircleHelp, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { ProjectMeta } from '../../core/model/types';
import { formatBytes, formatTime } from '../../core/util/math';
import { uid } from '../../core/util/id';
import { getRepo, storageEstimate } from '../../app/services';
import { openProject, setPendingImport, showError, useApp } from '../../app/store';
import { relativeDate, useT } from '../../i18n';
import { pickFiles, saveFile } from '../../platform/platform';
import { readProjectFile, writeProjectFile, PROJECT_EXTENSION, PROJECT_MIME } from '../../core/format/projectFile';
import { blobToBitmap } from '../../engine/canvas';
import { dialogs } from '../components/dialogs';
import { Menu, useMenu, type MenuEntry } from '../components/Menu';
import { toast } from '../components/toast';
import { Button, IconButton } from '../components/ui';
import { NewProjectDialog, type NewProjectInitial } from './NewProjectDialog';
import { TrashDialog } from './TrashDialog';
import { VersionsDialog } from './VersionsDialog';
import { Logo } from '../components/Logo';

function Thumb({ meta }: { meta: ProjectMeta }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    let alive = true;
    if (meta.thumbKey)
      getRepo()
        .then((r) => r.getAsset(meta.id, meta.thumbKey!))
        .then((b) => {
          if (b && alive) setUrl((u = URL.createObjectURL(b)));
        })
        .catch(() => undefined);
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [meta.id, meta.thumbKey]);
  return (
    <div className="thumb" style={{ aspectRatio: `${meta.width} / ${meta.height}` }}>
      {url ? <img src={url} alt="" draggable={false} /> : <span className="thumb-empty" />}
    </div>
  );
}

function ProjectCard({ meta, recovery, onChanged, onVersions }: { meta: ProjectMeta; recovery: boolean; onChanged: () => void; onVersions: (m: ProjectMeta) => void }) {
  const t = useT();
  const menu = useMenu();
  const items: MenuEntry[] = [
    { label: t('common.open'), icon: FolderOpen, onClick: () => void openProject(meta.id) },
    {
      label: t('common.rename'),
      icon: Pencil,
      onClick: async () => {
        const name = await dialogs.prompt(t('project.renameTitle'), t('common.name'), meta.name);
        if (!name) return;
        await (await getRepo()).rename(meta.id, name);
        onChanged();
      },
    },
    {
      label: t('common.duplicate'),
      icon: Copy,
      onClick: async () => {
        try {
          await (await getRepo()).duplicate(meta.id, uid('p'), t('project.duplicateName', { name: meta.name }));
          onChanged();
        } catch (e) {
          await showError(e, 'error.openProject');
        }
      },
    },
    {
      label: t('project.export'),
      icon: Download,
      onClick: async () => {
        try {
          const repo = await getRepo();
          const { doc } = await repo.load(meta.id);
          const thumb = meta.thumbKey ? await repo.getAsset(meta.id, meta.thumbKey) : null;
          const blob = await writeProjectFile(doc, (k) => repo.getAsset(meta.id, k), thumb);
          if (await saveFile(blob, `${meta.name}${PROJECT_EXTENSION}`, PROJECT_MIME)) toast('toast.projectExported', 'success');
        } catch (e) {
          await showError(e, 'error.exportFailed');
        }
      },
    },
    { label: t('project.versions'), icon: History, onClick: () => onVersions(meta) },
    'sep',
    {
      label: t('common.delete'),
      icon: Trash2,
      danger: true,
      onClick: async () => {
        if (!(await dialogs.confirm(t('home.trash'), t('project.trashConfirm', { name: meta.name }), t('common.delete'), true))) return;
        await (await getRepo()).trash(meta.id);
        toast('project.trashed');
        onChanged();
      },
    },
  ];
  return (
    <div className="project-card" data-testid="project-card">
      <button type="button" className="project-open" onClick={() => void openProject(meta.id)} aria-label={`${t('common.open')} ${meta.name}`}>
        <Thumb meta={meta} />
      </button>
      <div className="project-info">
        <div className="row">
          <div className="grow">
            <div className="project-name ellipsis" title={meta.name}>
              {meta.name}
            </div>
            <div className="small muted ellipsis">
              {meta.width}×{meta.height} · {t('home.frames', { n: meta.frameCount })} · {meta.fps} {t('common.fps')} · {formatTime(meta.durationSec)}
            </div>
            <div className="small faint">{t('home.modified', { date: relativeDate(meta.modifiedAt, t) })}</div>
            {recovery && <div className="small recovery-badge">{t('home.recoveryBadge')}</div>}
          </div>
          <IconButton icon={MoreVertical} label={t('project.menu')} onClick={menu.open} testId="project-menu" />
        </div>
      </div>
      {menu.anchor && <Menu anchor={menu.anchor} items={items} onClose={menu.close} />}
    </div>
  );
}

export function HomeScreen() {
  const t = useT();
  const go = useApp((s) => s.go);
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [recoveries, setRecoveries] = useState<Set<string>>(new Set());
  const [trashCount, setTrashCount] = useState(0);
  const [usage, setUsage] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState<NewProjectInitial | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [versionsFor, setVersionsFor] = useState<ProjectMeta | null>(null);
  const [query, setQuery] = useState('');
  const importMenu = useMenu();

  const refresh = useCallback(async () => {
    try {
      const repo = await getRepo();
      setProjects(await repo.list());
      setTrashCount((await repo.listTrash()).length);
      setRecoveries(new Set((await repo.listRecoveries()).map((r) => r.projectId)));
      const est = await storageEstimate();
      setUsage(est ? formatBytes(est.usage) : null);
    } catch {
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const importProjectFile = async () => {
    const [file] = await pickFiles(`${PROJECT_EXTENSION},application/zip,application/octet-stream`);
    if (!file) return;
    try {
      const repo = await getRepo();
      const res = await readProjectFile(file);
      const exists = await repo.getMeta(res.doc.id);
      const id = exists ? uid('p') : res.doc.id;
      const doc = { ...res.doc, id };
      await repo.putAssets(id, [...res.assets].map(([key, blob]) => ({ key, blob })));
      let thumbKey: string | null = null;
      if (res.thumbnail) {
        thumbKey = uid('t');
        await repo.putAsset(id, thumbKey, res.thumbnail);
      }
      await repo.commit(doc, thumbKey);
      if (res.missingAssets.length) toast('import.missingAssets', 'info', { n: res.missingAssets.length });
      else toast('import.projectDone', 'success');
      await refresh();
    } catch (e) {
      await showError(e, 'error.notProject');
    }
  };

  /** Create a project sized to the imported media, then import it into the editor. */
  const importMedia = async (kind: 'image' | 'sequence' | 'video') => {
    const accept = kind === 'video' ? 'video/*' : 'image/*';
    const files = await pickFiles(accept, kind === 'sequence');
    if (!files.length) return;
    try {
      let w = 1280,
        h = 720;
      if (kind === 'video') {
        const dims = await videoSize(files[0]);
        w = dims.w;
        h = dims.h;
      } else {
        const bmp = await blobToBitmap(files[0]);
        w = bmp.width;
        h = bmp.height;
        bmp.close();
      }
      const k = Math.min(1, 4096 / Math.max(w, h));
      setPendingImport({ kind, files });
      setNewOpen({ width: Math.round(w * k), height: Math.round(h * k), name: files[0].name.replace(/\.[^.]+$/, '').slice(0, 60), frames: 1 });
    } catch (e) {
      await showError(e, kind === 'video' ? 'error.videoDecode' : 'error.imageDecode');
    }
  };

  const shown = (projects ?? []).filter((p) => !query || p.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="home" data-testid="home">
      <header className="home-header">
        <div className="row brand">
          <Logo size={34} />
          <div>
            <h1>{t('app.name')}</h1>
            <div className="small muted">{t('app.tagline')}</div>
          </div>
        </div>
        <div className="row">
          <IconButton icon={Trash2} label={t('home.trashCount', { n: trashCount })} onClick={() => setTrashOpen(true)} badge={trashCount > 0} testId="open-trash" />
          <IconButton icon={CircleHelp} label={t('home.help')} onClick={() => go('help')} />
          <IconButton icon={Settings} label={t('home.settings')} onClick={() => go('settings')} testId="open-settings" />
        </div>
      </header>

      <main className="home-main scroll">
        <section className="home-actions">
          <button type="button" className="action-card primary" onClick={() => setNewOpen({})} data-testid="new-project">
            <Plus size={30} aria-hidden />
            <span className="action-title">{t('home.newProject')}</span>
            <span className="action-hint">{t('home.newProjectHint')}</span>
          </button>
          <button type="button" className="action-card" onClick={importProjectFile} data-testid="open-file">
            <FolderOpen size={26} aria-hidden />
            <span className="action-title">{t('home.openFile')}</span>
            <span className="action-hint">{t('home.openFileHint')}</span>
          </button>
          <button type="button" className="action-card" onClick={importMenu.open}>
            <Upload size={26} aria-hidden />
            <span className="action-title">{t('home.import')}</span>
            <span className="action-hint">{t('home.importHint')}</span>
          </button>
          {importMenu.anchor && (
            <Menu
              anchor={importMenu.anchor}
              onClose={importMenu.close}
              items={[
                { label: t('home.importImage'), icon: FileImage, onClick: () => void importMedia('image') },
                { label: t('home.importSequence'), icon: Images, onClick: () => void importMedia('sequence') },
                { label: t('home.importVideo'), icon: FileVideo, onClick: () => void importMedia('video') },
                { label: t('home.importProject'), icon: FileArchive, onClick: () => void importProjectFile() },
              ]}
            />
          )}
        </section>

        <section>
          <div className="row home-section-head">
            <h2 className="grow">{t('home.recent')}</h2>
            {(projects?.length ?? 0) > 3 && (
              <label className="search">
                <Search size={16} aria-hidden />
                <input className="input" placeholder={t('home.search')} aria-label={t('home.search')} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
              </label>
            )}
          </div>
          {projects === null ? (
            <div className="empty-state">
              <div className="spinner" style={{ margin: 'auto' }} />
            </div>
          ) : shown.length === 0 ? (
            <div className="empty-state card">
              <p>{t('home.empty')}</p>
              <Button variant="primary" icon={Plus} onClick={() => setNewOpen({})}>
                {t('home.newProject')}
              </Button>
            </div>
          ) : (
            <div className="project-grid">
              {shown.map((m) => (
                <ProjectCard key={m.id} meta={m} recovery={recoveries.has(m.id)} onChanged={refresh} onVersions={setVersionsFor} />
              ))}
            </div>
          )}
        </section>
        {usage && <div className="small faint home-foot">{t('home.storage', { used: usage })}</div>}
      </main>

      {newOpen && (
        <NewProjectDialog
          initial={newOpen}
          projectCount={projects?.length ?? 0}
          onClose={() => {
            setNewOpen(null);
          }}
        />
      )}
      {trashOpen && <TrashDialog onClose={() => (setTrashOpen(false), void refresh())} />}
      {versionsFor && <VersionsDialog meta={versionsFor} onClose={() => setVersionsFor(null)} />}
    </div>
  );
}

function videoSize(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({ w: v.videoWidth || 1280, h: v.videoHeight || 720 });
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('video-decode'));
    };
    v.src = url;
  });
}
