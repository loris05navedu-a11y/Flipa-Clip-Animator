import { Component, lazy, Suspense, useEffect, type ReactNode } from 'react';
import { useApp, openProject, showError } from './store';
import { useThemeSync } from './theme';
import { getRepo, requestPersistence } from './services';
import { installLifecycle } from '../platform/lifecycle';
import { DialogHost, dialogs, ErrorBody } from '../ui/components/dialogs';
import { ToastHost } from '../ui/components/ToastHost';
import { HomeScreen } from '../ui/home/HomeScreen';
import { t, useT } from '../i18n';
import { settings } from '../storage/settings';
import { isCancel, friendlyError } from '../ui/components/errors';
import { toast } from '../ui/components/toast';

const EditorScreen = lazy(() => import('../ui/editor/EditorScreen'));
const SettingsScreen = lazy(() => import('../ui/settings/SettingsScreen'));
const HelpScreen = lazy(() => import('../ui/help/HelpScreen'));

function Loading({ label }: { label?: string | null }) {
  return (
    <div className="loading-screen" role="status">
      <div className="spinner" />
      {label && <div>{label}</div>}
    </div>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  override state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override componentDidCatch(error: unknown) {
    console.error(error);
    // Make sure the latest work is in the recovery slot.
    useApp.getState().session?.autosave().catch(() => undefined);
  }
  override render() {
    if (!this.state.error) return this.props.children;
    const f = friendlyError(this.state.error);
    return (
      <div className="loading-screen" style={{ padding: 24 }}>
        <div className="card" style={{ padding: 20, maxWidth: 520 }}>
          <h2 style={{ marginTop: 0 }}>{t('error.title')}</h2>
          <ErrorBody message={t('error.crash')} details={f.details} />
          <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
            <button className="btn primary" onClick={() => location.reload()}>
              {t('error.reload')}
            </button>
          </div>
        </div>
      </div>
    );
  }
}

/** Offer recovery copies left by a previous crash. */
async function checkRecoveries(): Promise<void> {
  const repo = await getRepo();
  const recs = (await repo.listRecoveries()).filter((r) => !r.dismissed);
  for (const r of recs) {
    await repo.ensureMetaForRecovery(r.doc);
    const choice = await dialogs.choice(
      t('recovery.title'),
      `${t('recovery.message')}\n${t('recovery.detail', { name: r.doc.name, date: new Date(r.savedAt).toLocaleString() })}`,
      [
        { label: t('recovery.restore'), value: 'restore', variant: 'primary' },
        { label: t('recovery.ignore'), value: 'ignore' },
        { label: t('recovery.delete'), value: 'delete', variant: 'danger' },
      ],
      false,
    );
    if (choice === 'restore') {
      await openProject(r.projectId, 'recovery');
      return;
    }
    if (choice === 'delete') await repo.deleteRecovery(r.projectId);
    else await repo.dismissRecovery(r.projectId);
  }
}

export function App() {
  const dark = useThemeSync();
  const screen = useApp((s) => s.screen);
  const busy = useApp((s) => s.busy);
  const tr = useT();
  void dark;

  useEffect(() => {
    installLifecycle();
    void requestPersistence();
    const onErr = (e: PromiseRejectionEvent | ErrorEvent) => {
      const err = 'reason' in e ? e.reason : e.error;
      if (isCancel(err) || !err) return;
      console.error(err);
      toast(friendlyError(err).key, 'error');
    };
    window.addEventListener('unhandledrejection', onErr);
    window.addEventListener('error', onErr);
    (async () => {
      try {
        const repo = await getRepo();
        await repo.purgeTrash().catch(() => 0);
        await checkRecoveries();
        const s = settings();
        if (!useApp.getState().session && s.startup === 'lastProject' && s.lastProjectId) {
          const meta = await repo.getMeta(s.lastProjectId);
          if (meta && !meta.deletedAt) await openProject(meta.id);
        }
      } catch (e) {
        await showError(e, 'error.database');
      }
    })();
    return () => {
      window.removeEventListener('unhandledrejection', onErr);
      window.removeEventListener('error', onErr);
    };
  }, []);

  return (
    <ErrorBoundary>
      <Suspense fallback={<Loading />}>
        {screen === 'home' && <HomeScreen />}
        {screen === 'editor' && <EditorScreen />}
        {screen === 'settings' && <SettingsScreen />}
        {screen === 'help' && <HelpScreen />}
      </Suspense>
      {busy && (
        <div className="overlay" style={{ zIndex: 800 }}>
          <Loading label={busy ?? tr('common.loading')} />
        </div>
      )}
      <DialogHost />
      <ToastHost />
    </ErrorBoundary>
  );
}
