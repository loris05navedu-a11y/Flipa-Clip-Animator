import { Check, ClipboardPaste, Copy, CopyPlus, Eraser, FlipHorizontal2, FlipVertical2, Layers, Move, PaintBucket, RotateCcw, RotateCw, Scissors, Undo2, X, Type, SquareX } from 'lucide-react';
import { useState } from 'react';
import { useT } from '../../i18n';
import * as sel from '../../editor/selectionOps';
import { tools, useTools } from '../../editor/toolStore';
import { setUi } from '../../editor/controller';
import { clipboard } from '../../engine/Clipboard';
import { Menu } from '../components/Menu';
import { IconButton, NumberInput } from '../components/ui';
import { useCtrl, useSession } from './context';

/** Floating action bar for the current selection or transform. */
export function ContextBar() {
  const t = useT();
  const ctrl = useCtrl();
  const s = useSession();
  const tool = useTools((x) => x.tool);
  const proportional = useTools((x) => x.transform.proportional);
  const [layersAnchor, setLayersAnchor] = useState<HTMLElement | null>(null);
  const f = s.floating;

  if (f) {
    const upd = (patch: Partial<typeof f.t>) => {
      f.t = { ...f.t, ...patch };
      s.emit('floating');
    };
    return (
      <div className="context-bar" role="toolbar" aria-label={t('tool.transform')} data-testid="transform-bar">
        <IconButton icon={X} label={t('transform.cancel')} onClick={() => s.cancelFloating()} testId="transform-cancel" />
        {f.kind === 'text' && <IconButton icon={Type} label={t('text.edit')} onClick={() => setUi({ panelTab: 'tool' })} />}
        <IconButton icon={FlipHorizontal2} label={t('select.flipH')} onClick={() => upd({ sx: -f.t.sx })} />
        <IconButton icon={FlipVertical2} label={t('select.flipV')} onClick={() => upd({ sy: -f.t.sy })} />
        <IconButton icon={RotateCcw} label={t('transform.rotateLeft')} onClick={() => upd({ rotation: f.t.rotation - Math.PI / 2 })} />
        <IconButton icon={RotateCw} label={t('transform.rotateRight')} onClick={() => upd({ rotation: f.t.rotation + Math.PI / 2 })} />
        <IconButton icon={Undo2} label={t('transform.reset')} onClick={() => upd({ ...f.origin })} />
        <label className="mini-check">
          <input type="checkbox" checked={proportional} onChange={(e) => tools().setTransform({ proportional: e.target.checked })} /> {t('transform.proportional')}
        </label>
        <div className="transform-fields hide-narrow">
          <NumberInput label={t('transform.x')} width={64} value={Math.round(f.t.cx - (f.canvas.width * Math.abs(f.t.sx)) / 2)} onChange={(v) => upd({ cx: v + (f.canvas.width * Math.abs(f.t.sx)) / 2 })} />
          <NumberInput label={t('transform.y')} width={64} value={Math.round(f.t.cy - (f.canvas.height * Math.abs(f.t.sy)) / 2)} onChange={(v) => upd({ cy: v + (f.canvas.height * Math.abs(f.t.sy)) / 2 })} />
          <NumberInput label={t('transform.scaleX')} width={60} value={Math.round(f.t.sx * 100)} onChange={(v) => upd({ sx: v / 100 || 0.01 })} />
          <NumberInput label={t('transform.scaleY')} width={60} value={Math.round(f.t.sy * 100)} onChange={(v) => upd({ sy: v / 100 || 0.01 })} />
          <NumberInput label={t('transform.angle')} width={60} value={Math.round((f.t.rotation * 180) / Math.PI)} onChange={(v) => upd({ rotation: (v * Math.PI) / 180 })} />
          <NumberInput label={t('transform.skew')} width={56} min={-80} max={80} value={Math.round((f.t.skew * 180) / Math.PI)} onChange={(v) => upd({ skew: (v * Math.PI) / 180 })} />
        </div>
        <button type="button" className="btn primary small" onClick={() => void s.commitFloating()} data-testid="transform-apply">
          <Check size={18} aria-hidden /> {t('transform.apply')}
        </button>
      </div>
    );
  }

  if (!s.selection) {
    if (clipboard.pixels && (tool === 'select' || tool === 'transform'))
      return (
        <div className="context-bar">
          <IconButton icon={ClipboardPaste} label={t('select.paste')} onClick={() => void ctrl.paste()} />
        </div>
      );
    return null;
  }

  const layers = s.doc.layers.filter((l) => l.id !== s.layerId && !l.locked);
  return (
    <div className="context-bar" role="toolbar" aria-label={t('tool.select')} data-testid="selection-bar">
      <IconButton icon={Move} label={t('select.transform')} onClick={() => ctrl.setTool('transform')} testId="sel-transform" />
      <IconButton icon={Copy} label={t('select.copy')} onClick={() => void ctrl.copy()} testId="sel-copy" />
      <IconButton icon={Scissors} label={t('select.cut')} onClick={() => void sel.cutSelection(s)} />
      <IconButton icon={ClipboardPaste} label={t('select.paste')} disabled={!clipboard.pixels} onClick={() => void ctrl.paste()} />
      <IconButton icon={CopyPlus} label={t('select.duplicate')} onClick={() => void sel.duplicateSelection(s).then((ok) => ok && ctrl.setTool('transform'))} />
      <IconButton icon={Eraser} label={t('select.delete')} onClick={() => void sel.deleteSelection(s)} testId="sel-delete" />
      <IconButton icon={PaintBucket} label={t('select.fill')} onClick={() => void sel.fillSelection(s, tools().primary)} />
      <IconButton icon={FlipHorizontal2} label={t('select.flipH')} onClick={() => void sel.flipSelection(s, 'h')} />
      <IconButton icon={FlipVertical2} label={t('select.flipV')} onClick={() => void sel.flipSelection(s, 'v')} />
      <IconButton icon={Layers} label={t('select.toLayer')} disabled={!layers.length} onClick={(e) => setLayersAnchor(e.currentTarget)} />
      <IconButton icon={SquareX} label={t('select.none')} onClick={() => sel.deselect(s)} testId="sel-none" />
      {layersAnchor && (
        <Menu
          anchor={layersAnchor}
          onClose={() => setLayersAnchor(null)}
          items={[{ title: t('select.toLayerTitle') }, ...layers.slice().reverse().map((l) => ({ label: l.name, onClick: () => void sel.moveSelectionToLayer(s, l.id) }))]}
        />
      )}
    </div>
  );
}
