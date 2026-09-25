import { ArrowLeftRight, Brush, Eraser, Hand, Image, Move, PaintBucket, PenTool, Pencil, Pipette, Shapes, SquareDashed, Type } from 'lucide-react';
import { useT } from '../../i18n';
import { useTools } from '../../editor/toolStore';
import type { ToolId } from '../../engine/tools/Tool';
import { IconButton, type IconType, toCssColor } from '../components/ui';
import { showPanel } from '../../editor/controller';
import { useCtrl } from './context';
import { useSettings } from '../../storage/settings';

export const TOOL_ICONS: Record<ToolId, IconType> = {
  brush: Brush,
  pencil: Pencil,
  pen: PenTool,
  eraser: Eraser,
  shape: Shapes,
  fill: PaintBucket,
  eyedropper: Pipette,
  select: SquareDashed,
  transform: Move,
  text: Type,
  hand: Hand,
  reference: Image,
};

const ORDER: ToolId[] = ['brush', 'pencil', 'pen', 'eraser', 'shape', 'fill', 'eyedropper', 'select', 'transform', 'text', 'hand', 'reference'];

export function ToolRail() {
  const t = useT();
  const ctrl = useCtrl();
  const tool = useTools((s) => s.tool);
  const primary = useTools((s) => s.primary);
  const secondary = useTools((s) => s.secondary);
  const swap = useTools((s) => s.swapColors);
  const left = useSettings((s) => s.handedness) === 'left';
  const side = left ? 'left' : 'right';
  return (
    <nav className="tool-rail" aria-label={t('tools.label')}>
      <div className="tool-list scroll">
        {ORDER.map((id) => (
          <IconButton
            key={id}
            icon={TOOL_ICONS[id]}
            label={t(`tool.${id}`)}
            active={tool === id}
            tipSide={side}
            testId={`tool-${id}`}
            onClick={() => {
              if (tool === id) showPanel('tool');
              ctrl.setTool(id);
            }}
          />
        ))}
      </div>
      <div className="color-stack">
        <button type="button" className="color-chip secondary" aria-label={t('color.secondary')} data-tip={t('color.secondary')} data-tip-side={side} onClick={() => showPanel('colors')}>
          <span style={{ background: toCssColor(secondary) }} />
        </button>
        <button type="button" className="color-chip primary" aria-label={t('color.primary')} data-tip={t('color.primary')} data-tip-side={side} data-testid="primary-color" onClick={() => showPanel('colors')}>
          <span style={{ background: toCssColor(primary) }} />
        </button>
        <button type="button" className="swap-colors" aria-label={t('color.swap')} data-tip={t('color.swap')} data-tip-side={side} onClick={swap}>
          <ArrowLeftRight size={14} aria-hidden />
        </button>
      </div>
    </nav>
  );
}
