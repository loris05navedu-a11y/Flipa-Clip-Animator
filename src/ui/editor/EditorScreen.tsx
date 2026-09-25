import { PanelRightOpen, PanelLeftOpen, Minimize } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo } from 'react';
import { closeEditor, takePendingImport, useApp } from '../../app/store';
import { useDarkMode } from '../../app/theme';
import { EditorController, setUi, useEditorUi } from '../../editor/controller';
import { heldKeys } from '../../editor/keys';
import { actionFor, comboFromEvent } from '../../editor/shortcuts';
import { useT } from '../../i18n';
import { onAppPause } from '../../platform/lifecycle';
import { settings, useSettings } from '../../storage/settings';
import { backDepth, pushBack } from '../components/back';
import { toast } from '../components/toast';
import { IconButton, Progress } from '../components/ui';
import { runAction } from './actions';
import { CanvasView } from './CanvasView';
import { ContextBar } from './ContextBar';
import { EditorContext } from './context';
import { importImageAsLayer, importSequence, openVideoImport } from './importActions';
import { SidePanel } from './SidePanel';
import { Timeline } from './Timeline';
import { ToolOptionsBar } from './ToolOptionsBar';
import { ToolRail } from './ToolRail';
import { TopBar } from './TopBar';

const ExportDialog = lazy(() => import('./dialogs/ExportDialog'));
const PreviewDialog = lazy(() => import('./dialogs/PreviewDialog'));
const ProjectSettingsDialog = lazy(() => import('./dialogs/ProjectSettingsDialog'));
const ResizeDialog = lazy(() => import('./dialogs/ResizeDialog'));
const VideoImportDialog = lazy(() => import('./dialogs/VideoImportDialog'));
const EditorVersions = lazy(() => import('./dialogs/EditorVersions'));

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function BusyOverlay() {
  const busy = useEditorUi((u) => u.busy);
  const progress = useEditorUi((u) => u.progress);
  if (!busy) return null;
  return (
    <div className="overlay" style={{ zIndex: 700 }} role="alertdialog" aria-busy="true">
      <div className="dialog narrow" style={{ padding: 20 }}>
        <div style={{ marginBottom: 12, fontWeight: 600 }}>{busy}</div>
        <Progress value={progress ?? 0} indeterminate={progress === null} />
      </div>
    </div>
  );
}

export default function EditorScreen() {
  const t = useT();
  const session = useApp((s) => s.session)!;
  const ctrl = useMemo(() => new EditorController(session), [session]);
  const dark = useDarkMode();
  const fullscreen = useEditorUi((u) => u.fullscreen);
  const dialog = useEditorUi((u) => u.dialog);
  const timelineVisible = useSettings((s) => s.timelineVisible);
  const panelOpen = useSettings((s) => s.sidePanelOpen);
  const panelW = useSettings((s) => s.sidePanelWidth);
  const left = useSettings((s) => s.handedness) === 'left';
  const compact = useSettings((s) => s.compact);
  const autosaveInterval = useSettings((s) => s.autosaveInterval);
  const setSettings = useSettings((s) => s.set);

  useEffect(() => () => ctrl.dispose(), [ctrl]);

  // Pending import from the home screen.
  useEffect(() => {
    const p = takePendingImport();
    if (!p) return;
    const run = async () => {
      if (p.kind === 'image') await importImageAsLayer(ctrl, p.files[0]);
      else if (p.kind === 'sequence') await importSequence(ctrl, p.files, { target: 'current', at: 'end', fit: 'contain' });
      else openVideoImport(p.files[0]);
    };
    setTimeout(() => void run(), 200);
  }, [ctrl]);

  // Keyboard shortcuts.
  useEffect(() => {
    const baseDepth = backDepth();
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') heldKeys.alt = true;
      if (isTyping(e) || backDepth() > baseDepth + 1) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (!e.repeat) {
          heldKeys.space = true;
          heldKeys.spaceUsed = false;
        }
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return;
      const action = actionFor(combo);
      if (!action) return;
      e.preventDefault();
      runAction(ctrl, action);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Alt') heldKeys.alt = false;
      if (e.key === ' ' && heldKeys.space) {
        heldKeys.space = false;
        if (!heldKeys.spaceUsed && !isTyping(e) && actionFor('space') === 'playPause') runAction(ctrl, 'playPause');
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [ctrl]);

  // Back button / Escape at editor level.
  useEffect(
    () =>
      pushBack(() => {
        if (useEditorUi.getState().fullscreen) ctrl.toggleFullscreen();
        else if (session.floating) session.cancelFloating();
        else void closeEditor();
        return true;
      }),
    [ctrl, session],
  );

  // Autosave: recovery copy on a timer, never while drawing.
  useEffect(() => {
    if (!autosaveInterval) return;
    let failed = false;
    const id = setInterval(() => {
      if (session.interacting || !session.needsAutosave) return;
      session.autosave().catch(() => {
        if (!failed) toast('toast.autosaveFailed', 'error');
        failed = true;
      });
    }, autosaveInterval * 1000);
    return () => clearInterval(id);
  }, [session, autosaveInterval]);

  // Going to background: flush a recovery copy immediately.
  useEffect(
    () =>
      onAppPause(() => {
        ctrl.stopPlayback();
        session.interacting = false;
        if (session.needsAutosave) void session.autosave().catch(() => undefined);
      }),
    [ctrl, session],
  );

  // Warn before closing the browser tab with unsaved work (web only).
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (session.dirty) {
        void session.autosave().catch(() => undefined);
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [session]);

  useEffect(() => setUi({ dialog: null, fullscreen: false, playing: false, busy: null, progress: null }), [session]);

  const resizePanel = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX,
      w0 = settings().sidePanelWidth;
    const move = (ev: PointerEvent) => setSettings({ sidePanelWidth: Math.max(240, Math.min(560, w0 + (left ? ev.clientX - x0 : x0 - ev.clientX))) });
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const cls = ['editor', fullscreen && 'is-fullscreen', left && 'left-handed', compact && 'compact', !panelOpen && 'panel-closed'].filter(Boolean).join(' ');

  return (
    <EditorContext.Provider value={ctrl}>
      <div className={cls} style={{ ['--panel-w' as string]: `${panelW}px` }} data-testid="editor">
        {!fullscreen && <TopBar />}
        <div className="editor-body">
          {!fullscreen && <ToolRail />}
          <main className="stage">
            <CanvasView ctrl={ctrl} dark={dark} />
            {!fullscreen && <ToolOptionsBar />}
            <ContextBar />
            {fullscreen && <IconButton icon={Minimize} label={t('editor.exitFullscreen')} className="exit-fullscreen" onClick={() => ctrl.toggleFullscreen()} />}
            {!fullscreen && !panelOpen && <IconButton icon={left ? PanelLeftOpen : PanelRightOpen} label={t('panel.expand')} className="panel-open-btn" onClick={() => setSettings({ sidePanelOpen: true })} />}
          </main>
          {!fullscreen && panelOpen && (
            <>
              <div className="panel-resize" onPointerDown={resizePanel} role="separator" aria-orientation="vertical" />
              <SidePanel />
            </>
          )}
        </div>
        {!fullscreen && timelineVisible && <Timeline />}
        <Suspense fallback={null}>
          {dialog === 'export' && <ExportDialog />}
          {dialog === 'preview' && <PreviewDialog />}
          {dialog === 'projectSettings' && <ProjectSettingsDialog />}
          {dialog === 'resize' && <ResizeDialog />}
          {dialog === 'videoImport' && <VideoImportDialog />}
          {dialog === 'versions' && <EditorVersions />}
        </Suspense>
        <BusyOverlay />
      </div>
    </EditorContext.Provider>
  );
}
