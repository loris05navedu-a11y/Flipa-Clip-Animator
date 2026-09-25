import { useSettings, type Language } from '../storage/settings';
import { en } from './en';
import { fr } from './fr';

const DICTS: Record<'fr' | 'en', Record<string, string>> = { fr, en };

export function resolveLanguage(lang: Language): 'fr' | 'en' {
  if (lang !== 'auto') return lang;
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'fr').toLowerCase();
  return nav.startsWith('fr') ? 'fr' : nav.startsWith('en') ? 'en' : 'fr';
}

export type Vars = Record<string, string | number>;
export type T = (key: string, vars?: Vars) => string;

export function translator(lang: 'fr' | 'en'): T {
  const dict = DICTS[lang];
  return (key, vars) => {
    let s = dict[key] ?? fr[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  };
}

/** Current translator outside React. */
export function t(key: string, vars?: Vars): string {
  return translator(resolveLanguage(useSettings.getState().language))(key, vars);
}

export function currentLocale(): string {
  return resolveLanguage(useSettings.getState().language) === 'fr' ? 'fr-FR' : 'en-GB';
}

/** React hook: re-renders when the language changes. */
export function useT(): T {
  const lang = useSettings((s) => s.language);
  return translator(resolveLanguage(lang));
}

/** "il y a 5 min" style relative dates. */
export function relativeDate(ts: number, tr: T = t): string {
  const d = Date.now() - ts;
  if (d < 60_000) return tr('misc.justNow');
  if (d < 3_600_000) return tr('misc.minutesAgo', { n: Math.floor(d / 60_000) });
  if (d < 86_400_000) return tr('misc.hoursAgo', { n: Math.floor(d / 3_600_000) });
  if (d < 7 * 86_400_000) return tr('misc.daysAgo', { n: Math.floor(d / 86_400_000) });
  return tr('misc.onDate', { date: new Date(ts).toLocaleDateString(currentLocale()) });
}
