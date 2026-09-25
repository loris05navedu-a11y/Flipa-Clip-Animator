import { Layers, Palette, SlidersHorizontal, Eye, Image, PanelRightClose, PanelLeftClose } from 'lucide-react';
import { useT } from '../../i18n';
import { setUi, useEditorUi } from '../../editor/controller';
import { X } from 'lucide-react';
import { useSettings } from '../../storage/settings';
import { IconButton } from '../components/ui';
import { LayersPanel } from './LayersPanel';
import { ColorPanel } from './ColorPanel';
import { ToolPanel } from './ToolPanel';
import { ViewPanel } from './ViewPanel';
import { RefsPanel } from './RefsPanel';

const TABS = [
  { id: 'layers', icon: Layers, key: 'panel.layers' },
  { id: 'colors', icon: Palette, key: 'panel.colors' },
  { id: 'tool', icon: SlidersHorizontal, key: 'panel.tool' },
  { id: 'view', icon: Eye, key: 'panel.view' },
  { id: 'refs', icon: Image, key: 'panel.refs' },
] as const;

export function SidePanel({ narrow = false }: { narrow?: boolean }) {
  const t = useT();
  const tab = useEditorUi((u) => u.panelTab);
  const left = useSettings((s) => s.handedness) === 'left';
  const set = useSettings((s) => s.set);
  return (
    <aside className="side-panel" aria-label={t('editor.panel')}>
      <div className="panel-tabs" role="tablist">
        {TABS.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={tab === x.id}
            className={`panel-tab${tab === x.id ? ' on' : ''}`}
            onClick={() => setUi({ panelTab: x.id })}
            data-testid={`tab-${x.id}`}
            title={t(x.key)}
          >
            <x.icon size={18} aria-hidden />
            <span className="tab-label">{t(x.key)}</span>
          </button>
        ))}
        {narrow ? (
          <IconButton icon={X} small label={t('common.close')} onClick={() => setUi({ panelOverlay: false })} testId="panel-close" />
        ) : (
          <IconButton icon={left ? PanelLeftClose : PanelRightClose} small label={t('panel.collapse')} onClick={() => set({ sidePanelOpen: false })} />
        )}
      </div>
      <div className="panel-body scroll" role="tabpanel">
        {tab === 'layers' && <LayersPanel />}
        {tab === 'colors' && <ColorPanel />}
        {tab === 'tool' && <ToolPanel />}
        {tab === 'view' && <ViewPanel />}
        {tab === 'refs' && <RefsPanel />}
      </div>
    </aside>
  );
}
