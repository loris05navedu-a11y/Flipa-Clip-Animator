import { App } from '@capacitor/app';
import { StatusBar } from '@capacitor/status-bar';
import { isNative } from './platform';
import { runBack } from '../ui/components/back';

type Fn = () => void;
const pauseHandlers = new Set<Fn>();

/** Register work to do when the app goes to background (flush autosave). */
export function onAppPause(fn: Fn): () => void {
  pauseHandlers.add(fn);
  return () => pauseHandlers.delete(fn);
}

let installed = false;
export function installLifecycle(): void {
  if (installed) return;
  installed = true;
  const pause = () => pauseHandlers.forEach((f) => f());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') pause();
  });
  window.addEventListener('pagehide', pause);
  if (isNative()) {
    App.addListener('pause', pause).catch(() => undefined);
    App.addListener('backButton', () => {
      if (!runBack()) App.minimizeApp().catch(() => undefined);
    }).catch(() => undefined);
  }
}

export async function setStatusBarHidden(hidden: boolean): Promise<void> {
  if (!isNative()) return;
  try {
    if (hidden) await StatusBar.hide();
    else await StatusBar.show();
  } catch {
    /* not available */
  }
}

export async function syncStatusBar(dark: boolean): Promise<void> {
  if (!isNative()) return;
  try {
    const { Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
    await StatusBar.setBackgroundColor({ color: dark ? '#121218' : '#f3f3f8' });
  } catch {
    /* ignore */
  }
}
