import type { EditorController } from '../../editor/controller';
import { setUi, ui } from '../../editor/controller';
import * as sel from '../../editor/selectionOps';
import { tools } from '../../editor/toolStore';
import type { ToolId } from '../../engine/tools/Tool';

/** Run a named action (keyboard shortcut, menu, gesture). Returns false if unknown. */
export function runAction(ctrl: EditorController, id: string): boolean {
  const s = ctrl.session;
  if (id.startsWith('tool.')) {
    ctrl.setTool(id.slice(5) as ToolId);
    return true;
  }
  switch (id) {
    case 'undo':
      void ctrl.undo();
      break;
    case 'redo':
      void ctrl.redo();
      break;
    case 'copy':
      void ctrl.copy();
      break;
    case 'paste':
      void ctrl.paste();
      break;
    case 'cut':
      void ctrl.cut();
      break;
    case 'save':
      void ctrl.save();
      break;
    case 'playPause':
      ctrl.togglePlay();
      break;
    case 'prevFrame':
      ctrl.step(-1);
      break;
    case 'nextFrame':
      ctrl.step(1);
      break;
    case 'firstFrame':
      ctrl.goFrame(0);
      break;
    case 'lastFrame':
      ctrl.goFrame(s.doc.frames.length - 1);
      break;
    case 'newFrame':
      ctrl.stopPlayback();
      s.addFrame('after');
      break;
    case 'duplicateFrame':
      ctrl.stopPlayback();
      s.duplicateFrames();
      break;
    case 'deleteFrame':
      ctrl.stopPlayback();
      s.deleteFrames();
      break;
    case 'newLayer':
      s.addLayer();
      break;
    case 'selectAll':
      sel.selectAll(s);
      break;
    case 'deselect':
      if (s.floating) void s.commitFloating();
      sel.deselect(s);
      break;
    case 'delete':
      if (s.selection || s.floating) void sel.deleteSelection(s);
      break;
    case 'duplicate':
      void sel.duplicateSelection(s).then((ok) => ok && ctrl.setTool('transform'));
      break;
    case 'toggleOnion':
      ctrl.toggleOnion();
      break;
    case 'toggleGrid':
      ctrl.toggleGrid();
      break;
    case 'fit':
      ctrl.fit();
      break;
    case 'actualSize':
      ctrl.setZoom(1);
      break;
    case 'zoomIn':
      ctrl.zoomBy(1.25);
      break;
    case 'zoomOut':
      ctrl.zoomBy(0.8);
      break;
    case 'swapColors':
      tools().swapColors();
      break;
    case 'brushBigger': {
      const v = ctrl.currentBrushSize();
      if (v !== null) ctrl.setBrushSize(v < 10 ? v + 1 : v * 1.15);
      break;
    }
    case 'brushSmaller': {
      const v = ctrl.currentBrushSize();
      if (v !== null) ctrl.setBrushSize(v <= 10 ? v - 1 : v / 1.15);
      break;
    }
    case 'preview':
      ctrl.stopPlayback();
      setUi({ dialog: 'preview' });
      break;
    case 'export':
      ctrl.stopPlayback();
      setUi({ dialog: 'export' });
      break;
    case 'fullscreen':
      ctrl.toggleFullscreen();
      break;
    case 'apply':
      if (s.floating) void s.commitFloating();
      break;
    case 'escape':
      if (ui().playing) ctrl.stopPlayback();
      else if (s.floating) s.cancelFloating();
      else if (s.selection) sel.deselect(s);
      else if (s.frameSelection.size) s.clearFrameSelection();
      else if (ui().fullscreen) ctrl.toggleFullscreen();
      break;
    default:
      return false;
  }
  return true;
}
