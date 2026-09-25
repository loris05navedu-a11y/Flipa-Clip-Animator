import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fr } from '../../src/i18n/fr';
import { en } from '../../src/i18n/en';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

describe('i18n', () => {
  it('French and English have the same keys', () => {
    const missingEn = Object.keys(fr).filter((k) => !(k in en));
    const missingFr = Object.keys(en).filter((k) => !(k in fr));
    expect(missingEn).toEqual([]);
    expect(missingFr).toEqual([]);
  });

  it('every literal key used in the source exists', () => {
    const src = walk(join(__dirname, '../../src')).filter((f) => !f.includes('/i18n/'));
    const used = new Set<string>();
    const re = /\b(?:t|tr)\(\s*'([a-zA-Z0-9_.-]+)'/g;
    const re2 = /(?:labelKey|titleKey|messageKey|hintKey|label|key):\s*'([a-z]+\.[a-zA-Z0-9_.-]+)'/g;
    for (const f of src) {
      const code = readFileSync(f, 'utf8');
      for (const m of code.matchAll(re)) used.add(m[1]);
      for (const m of code.matchAll(re2)) if (/^(tool|action|history|toast|panel|settings|export|gesture|preset|brush|pen|pencil|new|view|select|shape|eraser|timeline|layers|blend|audio|import|video|color|text|onion|refs|error)\./.test(m[1])) used.add(m[1]);
    }
    const missing = [...used].filter((k) => !(k in fr));
    expect(missing).toEqual([]);
  });
});
