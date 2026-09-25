import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, GripVertical, Lock, LockOpen, Merge, MoreVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { BLEND_MODES, type BlendMode, type LayerDef } from '../../core/model/types';
import { useT } from '../../i18n';
import { setUi } from '../../editor/controller';
import { ctx2d } from '../../engine/canvas';
import { dialogs } from '../components/dialogs';
import { Menu } from '../components/Menu';
import { toast } from '../components/toast';
import { IconButton, SelectInput, Slider } from '../components/ui';
import { useSession } from './context';

function LayerThumb({ layer }: { layer: LayerDef }) {
  const s = useSession();
  const ref = useRef<HTMLCanvasElement>(null);
  const celId = s.frame.cels[layer.id];
  const version = celId ? s.cels.version(celId) : -1;
  const ready = celId ? s.cels.isReady(celId) : true;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const { width, height } = s.doc;
    const k = Math.min(56 / width, 40 / height);
    c.width = Math.max(1, Math.round(width * k));
    c.height = Math.max(1, Math.round(height * k));
    const ctx = ctx2d(c);
    ctx.clearRect(0, 0, c.width, c.height);
    if (!celId) return;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    s.cels.draw(ctx, celId);
  }, [celId, version, ready, s, s.doc.width, s.doc.height]);
  return <canvas ref={ref} className="layer-thumb" aria-hidden />;
}

export function LayersPanel() {
  const t = useT();
  const s = useSession();
  const [menu, setMenu] = useState<{ anchor: HTMLElement; layer: LayerDef } | null>(null);
  const [drag, setDrag] = useState<{ id: string; startY: number; dy: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const layers = [...s.doc.layers].reverse(); // top first
  const active = s.layer;

  const rename = async (l: LayerDef) => {
    const name = await dialogs.prompt(t('layers.rename'), t('common.name'), l.name);
    if (name) s.updateLayer(l.id, { name: name.slice(0, 80) });
  };
  const remove = async (l: LayerDef) => {
    if (s.doc.layers.length <= 1) return toast('layers.cantDeleteLast', 'error');
    if (await dialogs.confirm(t('layers.delete'), t('layers.deleteConfirm', { name: l.name }), t('common.delete'), true)) s.deleteLayer(l.id);
  };
  const merge = async (l: LayerDef) => {
    setUi({ busy: t('layers.mergeProgress'), progress: 0 });
    try {
      await s.mergeDown(l.id, (p) => setUi({ progress: p }));
    } finally {
      setUi({ busy: null, progress: null });
    }
  };
  const move = (l: LayerDef, delta: number) => {
    const i = s.doc.layers.findIndex((x) => x.id === l.id);
    s.moveLayer(l.id, Math.max(0, Math.min(s.doc.layers.length - 1, i + delta)));
  };

  // Drag to reorder (by the grip handle).
  const rowH = 58;
  const onGripDown = (e: React.PointerEvent, l: LayerDef) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: l.id, startY: e.clientY, dy: 0 });
  };
  const onGripMove = (e: React.PointerEvent) => {
    if (drag) setDrag({ ...drag, dy: e.clientY - drag.startY });
  };
  const onGripUp = () => {
    if (!drag) return;
    const shift = Math.round(drag.dy / rowH);
    if (shift) {
      const i = s.doc.layers.findIndex((x) => x.id === drag.id);
      s.moveLayer(drag.id, Math.max(0, Math.min(s.doc.layers.length - 1, i - shift)));
    }
    setDrag(null);
  };

  return (
    <div className="panel-section layers-panel" data-testid="layers-panel">
      <div className="row panel-toolbar">
        <IconButton icon={Plus} label={t('layers.add')} onClick={() => s.addLayer()} testId="add-layer" />
        <IconButton icon={Copy} label={t('layers.duplicate')} onClick={() => s.duplicateLayer()} testId="duplicate-layer" />
        <IconButton icon={Merge} label={t('layers.mergeDown')} disabled={s.layerIndex <= 0} onClick={() => void merge(active)} testId="merge-layer" />
        <IconButton icon={ArrowUp} label={t('layers.moveUp')} disabled={s.layerIndex >= s.doc.layers.length - 1} onClick={() => move(active, 1)} />
        <IconButton icon={ArrowDown} label={t('layers.moveDown')} disabled={s.layerIndex <= 0} onClick={() => move(active, -1)} />
        <div className="spacer" />
        <IconButton icon={Trash2} danger label={t('layers.delete')} disabled={s.doc.layers.length <= 1} onClick={() => void remove(active)} testId="delete-layer" />
      </div>
      <div className="layer-list" ref={listRef} role="listbox" aria-label={t('layers.title')}>
        {layers.map((l) => {
          const dragging = drag?.id === l.id;
          return (
            <div
              key={l.id}
              role="option"
              aria-selected={l.id === active.id}
              className={`layer-row${l.id === active.id ? ' active' : ''}${dragging ? ' dragging' : ''}${!l.visible ? ' hidden-layer' : ''}`}
              style={dragging ? { transform: `translateY(${drag!.dy}px)` } : undefined}
              onClick={() => s.setLayer(l.id)}
              onDoubleClick={() => void rename(l)}
              data-testid="layer-row"
            >
              <span className="grip" onPointerDown={(e) => onGripDown(e, l)} onPointerMove={onGripMove} onPointerUp={onGripUp} onPointerCancel={() => setDrag(null)} aria-hidden>
                <GripVertical size={16} />
              </span>
              <LayerThumb layer={l} />
              <div className="grow layer-name-col">
                <div className="layer-name ellipsis">{l.name}</div>
                <div className="small faint ellipsis">
                  {Math.round(l.opacity * 100)} %{l.blendMode !== 'normal' ? ` · ${t(`blend.${l.blendMode}`)}` : ''}
                </div>
              </div>
              <IconButton
                icon={l.visible ? Eye : EyeOff}
                small
                label={`${t('layers.visible')} : ${l.visible ? t('common.visible') : t('common.hidden')}`}
                onClick={(e) => (e.stopPropagation(), s.updateLayer(l.id, { visible: !l.visible }))}
                testId="layer-visibility"
              />
              <IconButton
                icon={l.locked ? Lock : LockOpen}
                small
                toggled={l.locked}
                label={l.locked ? t('common.unlock') : t('common.lock')}
                onClick={(e) => (e.stopPropagation(), s.updateLayer(l.id, { locked: !l.locked }))}
                testId="layer-lock"
              />
              <IconButton
                icon={MoreVertical}
                small
                label={t('layers.options')}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu({ anchor: e.currentTarget, layer: l });
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="col layer-props">
        <Slider label={t('layers.opacity')} value={active.opacity} min={0} max={1} step={0.01} scale={100} unit=" %" testId="layer-opacity" onChange={(v) => s.updateLayer(active.id, { opacity: v }, 'opacity')} />
        <div className="field">
          <label>{t('layers.blend')}</label>
          <SelectInput<BlendMode> label={t('layers.blend')} value={active.blendMode} testId="layer-blend" onChange={(v) => s.updateLayer(active.id, { blendMode: v })} options={BLEND_MODES.map((b) => ({ value: b, label: t(`blend.${b}`) }))} />
        </div>
      </div>
      {menu && (
        <Menu
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          items={[
            { label: t('layers.rename'), icon: Pencil, onClick: () => void rename(menu.layer) },
            { label: t('layers.duplicate'), icon: Copy, onClick: () => s.duplicateLayer(menu.layer.id) },
            { label: t('layers.mergeDown'), icon: Merge, disabled: s.doc.layers.findIndex((x) => x.id === menu.layer.id) <= 0, onClick: () => void merge(menu.layer) },
            { label: t('layers.moveUp'), icon: ArrowUp, onClick: () => move(menu.layer, 1) },
            { label: t('layers.moveDown'), icon: ArrowDown, onClick: () => move(menu.layer, -1) },
            'sep',
            { label: t('layers.delete'), icon: Trash2, danger: true, disabled: s.doc.layers.length <= 1, onClick: () => void remove(menu.layer) },
          ]}
        />
      )}
    </div>
  );
}
