import { useState } from 'react';
import { Menu } from './Menu';
import { ColorPicker } from './ColorPicker';
import { Swatch } from './ui';

/** A labelled swatch that opens a colour picker popover. */
export function ColorField({ label, value, onChange, disabled, alpha = true }: { label: string; value: string; onChange: (hex: string) => void; disabled?: boolean; alpha?: boolean }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const v = value.length === 7 ? value + 'ff' : value;
  return (
    <div className="row" style={{ opacity: disabled ? 0.45 : 1, pointerEvents: disabled ? 'none' : undefined }}>
      <span onClick={(e) => setAnchor(e.currentTarget)} style={{ display: 'inline-flex' }}>
        <Swatch color={v} label={label} />
      </span>
      <span className="small">{label}</span>
      {anchor && (
        <Menu anchor={anchor} onClose={() => setAnchor(null)} width={520}>
          <ColorPicker value={v} onChange={(h) => onChange(alpha ? h : h.slice(0, 7) + 'ff')} />
        </Menu>
      )}
    </div>
  );
}
