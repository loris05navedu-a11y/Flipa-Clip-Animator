import { createContext, useContext, useSyncExternalStore } from 'react';
import type { EditorController } from '../../editor/controller';
import type { EditorSession } from '../../editor/EditorSession';

export const EditorContext = createContext<EditorController | null>(null);

export function useCtrl(): EditorController {
  const c = useContext(EditorContext);
  if (!c) throw new Error('EditorContext missing');
  return c;
}

/** Re-render on every session change and return the session. */
export function useSession(): EditorSession {
  const ctrl = useCtrl();
  useSyncExternalStore(ctrl.session.subscribe, ctrl.session.getVersion);
  return ctrl.session;
}
