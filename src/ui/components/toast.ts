import { create } from 'zustand';
import { t } from '../../i18n';

export interface ToastItem {
  id: number;
  message: string;
  kind: 'info' | 'error' | 'success';
  action?: { label: string; run: () => void };
}

interface ToastStore {
  items: ToastItem[];
  push(t: Omit<ToastItem, 'id'>, ms?: number): void;
  dismiss(id: number): void;
}

let seq = 0;
export const useToasts = create<ToastStore>((set, get) => ({
  items: [],
  push: (item, ms = 2800) => {
    const id = ++seq;
    // Collapse identical consecutive messages.
    const items = get().items.filter((x) => x.message !== item.message);
    set({ items: [...items, { ...item, id }].slice(-3) });
    setTimeout(() => get().dismiss(id), ms);
  },
  dismiss: (id) => set({ items: get().items.filter((x) => x.id !== id) }),
}));

/** Show a translated toast. */
export function toast(key: string, kind: ToastItem['kind'] = 'info', vars?: Record<string, string | number>): void {
  useToasts.getState().push({ message: t(key, vars), kind });
}

export function toastText(message: string, kind: ToastItem['kind'] = 'info'): void {
  useToasts.getState().push({ message, kind });
}
