import { create } from 'zustand';
import { EditorSession, type SessionOptions } from '../editor/EditorSession';
import type { ProjectData } from '../core/model/types';
import { customPresets, tools } from '../editor/toolStore';
import { settings, useSettings } from '../storage/settings';
import { t } from '../i18n';
import { getRepo } from './services';
import { dialogs } from '../ui/components/dialogs';
import { friendlyError } from '../ui/components/errors';
import { sanitizeBrush } from '../engine/brush/types';

export type Screen = 'home' | 'editor' | 'settings' | 'help';

interface AppState {
  screen: Screen;
  /** Where to go back from settings/help. */
  previous: Screen;
  session: EditorSession | null;
  busy: string | null;
  go(screen: Screen): void;
}

export const useApp = create<AppState>((set, get) => ({
  screen: 'home',
  previous: 'home',
  session: null,
  busy: null,
  go: (screen) => set({ previous: get().screen === screen ? get().previous : get().screen, screen }),
}));

export function sessionOptions(): Partial<SessionOptions> {
  const s = settings();
  return {
    historySteps: s.historySteps,
    historyBytes: Math.max(128, s.cacheBudgetMB) * 1024 * 1024 * 0.75,
    memoryBudget: s.cacheBudgetMB * 1024 * 1024,
    keepVersions: s.keepVersions,
    brushes: () => customPresets(),
    layerName: t('layers.defaultName'),
    copySuffix: t('layers.copySuffix'),
  };
}

async function showError(err: unknown, key: string): Promise<void> {
  const f = friendlyError(err, key);
  console.error(err);
  await dialogs.error(t('error.title'), t(f.key), f.details);
}

function enterEditor(session: EditorSession): void {
  // Custom brushes stored in the project become available in the library.
  const imported = tools().importPresets((session.doc.brushes ?? []).map(sanitizeBrush).filter(Boolean) as unknown[]);
  void imported;
  useSettings.getState().set({ lastProjectId: session.doc.id });
  useApp.setState({ session, screen: 'editor', busy: null });
}

export async function createProject(data: ProjectData): Promise<void> {
  useApp.setState({ busy: t('editor.opening') });
  try {
    const repo = await getRepo();
    const s = settings();
    data.view.onion.enabled = s.onionDefault;
    data.view.onion.before = s.onionBefore;
    data.view.onion.after = s.onionAfter;
    data.palettes = [];
    const session = await EditorSession.create(repo, data, sessionOptions());
    enterEditor(session);
  } catch (e) {
    useApp.setState({ busy: null });
    await showError(e, 'error.saveFailed');
  }
}

/** Open a project; offers the recovery copy when one exists. */
export async function openProject(id: string, from?: 'saved' | 'recovery' | number): Promise<boolean> {
  try {
    const repo = await getRepo();
    if (from === undefined) {
      const rec = await repo.getRecovery(id);
      from = 'saved';
      if (rec) {
        const choice = await dialogs.choice(
          t('recovery.title'),
          t('recovery.openChoice', { date: new Date(rec.savedAt).toLocaleString() }),
          [
            { label: t('recovery.openRecovered'), value: 'recovery', variant: 'primary' },
            { label: t('recovery.openSaved'), value: 'saved' },
          ],
        );
        if (!choice) return false;
        from = choice as 'saved' | 'recovery';
        if (from === 'saved') await repo.deleteRecovery(id);
      }
    }
    useApp.setState({ busy: t('editor.opening') });
    const session = await EditorSession.open(repo, id, from, sessionOptions());
    enterEditor(session);
    return true;
  } catch (e) {
    useApp.setState({ busy: null });
    await showError(e, 'error.openProject');
    return false;
  }
}

/** Leave the editor, asking to save unsaved changes. Returns false if cancelled. */
export async function closeEditor(): Promise<boolean> {
  const { session } = useApp.getState();
  if (!session) {
    useApp.setState({ screen: 'home' });
    return true;
  }
  if (session.dirty) {
    const choice = await dialogs.choice(t('editor.leaveTitle'), t('editor.leaveMessage', { name: session.doc.name }), [
      { label: t('common.save'), value: 'save', variant: 'primary' },
      { label: t('common.discard'), value: 'discard', variant: 'danger' },
      { label: t('common.cancel'), value: 'cancel' },
    ]);
    if (!choice || choice === 'cancel') return false;
    try {
      if (choice === 'save') await session.save();
      else await session.discard();
    } catch (e) {
      await showError(e, 'error.saveFailed');
      return false;
    }
  } else {
    await session.discard().catch(() => undefined);
  }
  session.close();
  useApp.setState({ session: null, screen: 'home' });
  return true;
}

export { showError };

/** Media to import right after a project is opened (import from the home screen). */
export interface PendingImport {
  kind: 'image' | 'sequence' | 'video';
  files: File[];
}
let pending: PendingImport | null = null;
export function setPendingImport(p: PendingImport | null): void {
  pending = p;
}
export function takePendingImport(): PendingImport | null {
  const p = pending;
  pending = null;
  return p;
}
