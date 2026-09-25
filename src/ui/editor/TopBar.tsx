import {
  ArrowLeftRight, CircleHelp, Clapperboard, Download, FileAudio, FileImage, FileVideo, Grid3x3, History, House, ImagePlus, Images, Layers2, Maximize, Minimize, MoreVertical,
  Redo2, Ruler, Save, Settings2, Undo2, Upload, Frame,
} from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { closeEditor, useApp } from '../../app/store';
import { setUi, useEditorUi } from '../../editor/controller';
import { useT } from '../../i18n';
import { pickFiles } from '../../platform/platform';
import { Menu, useMenu } from '../components/Menu';
import { IconButton } from '../components/ui';
import { useCtrl, useSession } from './context';
import { importAudio, importImageAsLayer, importImageFloating, importReference, importSequence, openVideoImport } from './importActions';

function SaveState() {
  const t = useT();
  const s = useSession();
  const saving = useEditorUi((u) => u.busy);
  void saving;
  const label = s.dirty ? t('editor.unsaved') : t('editor.saved');
  return (
    <span className={`save-state ${s.dirty ? 'dirty' : ''}`} role="status" aria-live="polite" title={label} data-testid="save-state">
      <span className="dot" aria-hidden />
      <span className="save-label">{label}</span>
    </span>
  );
}

export function TopBar() {
  const t = useT();
  const ctrl = useCtrl();
  const s = useSession();
  const fullscreen = useEditorUi((u) => u.fullscreen);
  const go = useApp((a) => a.go);
  const importMenu = useMenu();
  const moreMenu = useMenu();
  const viewMenu = useMenu();
  const hist = useSyncExternalStore(
    (cb) => s.history.changed.on(cb),
    () => s.history.state().canUndo + '|' + s.history.state().canRedo + '|' + s.history.state().undoLabel + '|' + s.history.state().redoLabel,
  );
  const [canUndo, canRedo, undoLabel, redoLabel] = hist.split('|');
  const v = s.doc.view;

  return (
    <header className="topbar">
      <IconButton icon={House} label={t('editor.home')} onClick={() => void closeEditor()} testId="editor-home" />
      <button type="button" className="project-title ellipsis" onClick={() => setUi({ dialog: 'projectSettings' })} title={t('editor.projectSettings')} data-testid="project-title">
        {s.doc.name}
      </button>
      <SaveState />
      <div className="spacer" />
      <IconButton
        icon={Undo2}
        label={canUndo === 'true' ? t('editor.undoLabel', { action: t(undoLabel) }) : t('editor.undo')}
        disabled={canUndo !== 'true' && !s.floating}
        onClick={() => void ctrl.undo()}
        testId="undo"
      />
      <IconButton icon={Redo2} label={canRedo === 'true' ? t('editor.redoLabel', { action: t(redoLabel) }) : t('editor.redo')} disabled={canRedo !== 'true'} onClick={() => void ctrl.redo()} testId="redo" />
      <IconButton icon={Save} label={`${t('editor.save')} (Ctrl+S)`} onClick={() => void ctrl.save()} testId="save" badge={s.dirty} />
      <div className="sep" />
      <IconButton icon={Layers2} label={t('onion.title')} toggled={v.onion.enabled} onClick={() => ctrl.toggleOnion()} testId="toggle-onion" />
      <IconButton icon={Grid3x3} label={t('editor.view')} onClick={viewMenu.open} toggled={v.grid.enabled || v.rulers || v.symmetry.mode !== 'off'} />
      <IconButton icon={Upload} label={t('editor.import')} onClick={importMenu.open} testId="import-menu" />
      <IconButton icon={Clapperboard} label={t('editor.preview')} onClick={() => (ctrl.stopPlayback(), setUi({ dialog: 'preview' }))} testId="open-preview" />
      <button type="button" className="btn primary export-btn" onClick={() => (ctrl.stopPlayback(), setUi({ dialog: 'export' }))} data-testid="open-export">
        <Download size={18} aria-hidden />
        <span className="hide-narrow">{t('editor.export')}</span>
      </button>
      <IconButton icon={MoreVertical} label={t('editor.more')} onClick={moreMenu.open} testId="more-menu" />

      {viewMenu.anchor && (
        <Menu
          anchor={viewMenu.anchor}
          onClose={viewMenu.close}
          items={[
            { label: t('view.grid'), icon: Grid3x3, checked: v.grid.enabled, onClick: () => ctrl.toggleGrid() },
            { label: t('view.rulers'), icon: Ruler, checked: v.rulers, onClick: () => s.updateView({ rulers: !v.rulers }) },
            { label: t('view.guidesVisible'), checked: v.guidesVisible, onClick: () => s.updateView({ guidesVisible: !v.guidesVisible }) },
            { label: t('refs.allVisible'), checked: v.referencesVisible, onClick: () => s.updateView({ referencesVisible: !v.referencesVisible }) },
            'sep',
            { label: t('editor.fit'), icon: Frame, onClick: () => ctrl.fit(), kbd: 'Ctrl+0' },
            { label: t('editor.actualSize'), onClick: () => ctrl.setZoom(1), kbd: 'Ctrl+1' },
            { label: t('editor.resetRotation'), icon: ArrowLeftRight, onClick: () => ctrl.resetRotation() },
            'sep',
            { label: t('view.title') + '…', onClick: () => setUi({ panelTab: 'view' }) },
          ]}
        />
      )}
      {importMenu.anchor && (
        <Menu
          anchor={importMenu.anchor}
          onClose={importMenu.close}
          items={[
            { label: t('import.image'), icon: FileImage, testId: 'import-image-layer', onClick: async () => { const [f] = await pickFiles('image/*'); if (f) await importImageAsLayer(ctrl, f); } },
            { label: t('import.imageFloating'), icon: ImagePlus, onClick: async () => { const [f] = await pickFiles('image/*'); if (f) await importImageFloating(ctrl, f); } },
            { label: t('import.sequence'), icon: Images, onClick: async () => { const fs = await pickFiles('image/*', true); if (fs.length) await importSequence(ctrl, fs); } },
            { label: t('import.video'), icon: FileVideo, testId: 'import-video', onClick: async () => { const [f] = await pickFiles('video/*'); if (f) openVideoImport(f); } },
            { label: t('import.audio'), icon: FileAudio, testId: 'import-audio', onClick: async () => { const [f] = await pickFiles('audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus'); if (f) await importAudio(ctrl, f); } },
            { label: t('import.reference'), icon: ImagePlus, onClick: async () => { const [f] = await pickFiles('image/*'); if (f) await importReference(ctrl, f); } },
          ]}
        />
      )}
      {moreMenu.anchor && (
        <Menu
          anchor={moreMenu.anchor}
          onClose={moreMenu.close}
          items={[
            { label: t('editor.projectSettings'), icon: Settings2, onClick: () => setUi({ dialog: 'projectSettings' }), testId: 'menu-project-settings' },
            { label: t('editor.canvasSize'), icon: Frame, onClick: () => setUi({ dialog: 'resize' }) },
            { label: t('editor.versions'), icon: History, onClick: () => setUi({ dialog: 'versions' }) },
            'sep',
            { label: fullscreen ? t('editor.exitFullscreen') : t('editor.fullscreen'), icon: fullscreen ? Minimize : Maximize, onClick: () => ctrl.toggleFullscreen(), kbd: 'Tab' },
            { label: t('home.settings'), icon: Settings2, onClick: () => go('settings') },
            { label: t('editor.help'), icon: CircleHelp, onClick: () => go('help') },
          ]}
        />
      )}
    </header>
  );
}
