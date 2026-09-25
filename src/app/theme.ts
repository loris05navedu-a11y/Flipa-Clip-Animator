import { useEffect, useState } from 'react';
import { useSettings } from '../storage/settings';
import { syncStatusBar } from '../platform/lifecycle';

function systemDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

/** True when the dark theme is in effect. */
export function useDarkMode(): boolean {
  const theme = useSettings((s) => s.theme);
  const [sys, setSys] = useState(systemDark());
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSys(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return theme === 'dark' || (theme === 'system' && sys);
}

/** Apply theme / UI size / accessibility attributes on <html>. */
export function useThemeSync(): boolean {
  const ui = useSettings((s) => s.uiSize);
  const tooltips = useSettings((s) => s.tooltips);
  const reduce = useSettings((s) => s.reduceMotion);
  const lang = useSettings((s) => s.language);
  const dark = useDarkMode();
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = dark ? 'dark' : 'light';
    root.dataset.ui = ui;
    root.dataset.tooltips = tooltips ? 'on' : 'off';
    root.dataset.motion = reduce ? 'reduce' : 'normal';
    root.lang = lang === 'en' ? 'en' : lang === 'fr' ? 'fr' : navigator.language.startsWith('en') ? 'en' : 'fr';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#121218' : '#f3f3f8');
    void syncStatusBar(dark);
  }, [dark, ui, tooltips, reduce, lang]);
  return dark;
}
