import { hexToCss } from '../../core/color/color';
import type { TextSettings } from '../../editor/toolStore';
import { createCanvas, ctx2d } from '../canvas';

export const FONTS: { family: string; label: string }[] = [
  { family: 'Inter', label: 'Inter' },
  { family: 'Lora', label: 'Lora' },
  { family: 'Fredoka', label: 'Fredoka' },
  { family: 'Bangers', label: 'Bangers' },
  { family: 'Caveat', label: 'Caveat' },
  { family: 'Permanent Marker', label: 'Permanent Marker' },
  { family: 'Roboto Mono', label: 'Roboto Mono' },
  { family: 'serif', label: 'Serif (système)' },
  { family: 'sans-serif', label: 'Sans-serif (système)' },
  { family: 'monospace', label: 'Monospace (système)' },
];

export interface TextMeta {
  text: string;
}

export function fontString(s: TextSettings): string {
  const family = /^(serif|sans-serif|monospace|cursive)$/.test(s.font) ? s.font : `"${s.font}"`;
  return `${s.italic ? 'italic ' : ''}${s.bold ? '700 ' : '400 '}${Math.max(1, Math.round(s.size))}px ${family}`;
}

/** Make sure a web font is ready before measuring / drawing it. */
export async function ensureFont(s: TextSettings): Promise<void> {
  try {
    await document.fonts.load(fontString(s), 'AaÀé');
  } catch {
    /* fall back to whatever is available */
  }
}

/** Rasterise a block of text with its styling. */
export function renderText(text: string, s: TextSettings, color: string): HTMLCanvasElement {
  const lines = (text || ' ').split('\n');
  const measure = ctx2d(createCanvas(1, 1));
  measure.font = fontString(s);
  if ('letterSpacing' in measure) (measure as unknown as { letterSpacing: string }).letterSpacing = `${s.letterSpacing}px`;
  const widths = lines.map((l) => measure.measureText(l || ' ').width);
  const lineH = s.size * s.lineHeight;
  const outline = s.outline ? s.outlineWidth : 0;
  const shadow = s.shadow ? Math.max(Math.abs(s.shadowX), Math.abs(s.shadowY)) + s.shadowBlur * 2 : 0;
  const pad = Math.ceil(outline + shadow + s.size * 0.25);
  const w = Math.ceil(Math.max(...widths)) + pad * 2;
  const h = Math.ceil(lineH * lines.length + s.size * 0.3) + pad * 2;
  const c = createCanvas(Math.min(8192, w), Math.min(8192, h));
  const ctx = ctx2d(c);
  ctx.font = fontString(s);
  if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${s.letterSpacing}px`;
  ctx.textBaseline = 'alphabetic';
  ctx.globalAlpha = s.opacity;
  ctx.lineJoin = 'round';
  const maxW = Math.max(...widths);
  lines.forEach((line, i) => {
    const lw = widths[i];
    const x = pad + (s.align === 'center' ? (maxW - lw) / 2 : s.align === 'right' ? maxW - lw : 0);
    const y = pad + s.size * 0.95 + i * lineH;
    if (s.shadow) {
      ctx.save();
      ctx.shadowColor = hexToCss(s.shadowColor);
      ctx.shadowBlur = s.shadowBlur;
      ctx.shadowOffsetX = s.shadowX;
      ctx.shadowOffsetY = s.shadowY;
      ctx.fillStyle = hexToCss(color);
      ctx.fillText(line, x, y);
      if (s.outline) {
        ctx.lineWidth = s.outlineWidth * 2;
        ctx.strokeStyle = hexToCss(s.outlineColor);
        ctx.strokeText(line, x, y);
      }
      ctx.restore();
    }
    if (s.outline) {
      ctx.lineWidth = s.outlineWidth * 2;
      ctx.strokeStyle = hexToCss(s.outlineColor);
      ctx.strokeText(line, x, y);
    }
    ctx.fillStyle = hexToCss(color);
    ctx.fillText(line, x, y);
  });
  return c;
}
