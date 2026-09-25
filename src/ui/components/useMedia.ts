import { useEffect, useState } from 'react';

export function useMedia(query: string): boolean {
  const get = () => typeof matchMedia === 'function' && matchMedia(query).matches;
  const [v, setV] = useState(get);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(query);
    const on = () => setV(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return v;
}

/** Tablet portrait and phones: the side panel floats over the canvas. */
export const useNarrow = (): boolean => useMedia('(max-width: 900px)');
/** Phones (either orientation). */
export const usePhone = (): boolean => useMedia('(max-width: 600px), (max-height: 500px)');
