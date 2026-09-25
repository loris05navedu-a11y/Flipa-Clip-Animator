import { ProjectFormatError } from '../../core/model/project';
import { CancelledError } from '../../core/util/async';

/** Map any thrown value to a friendly, translated message key + technical details. */
export function friendlyError(err: unknown, fallbackKey = 'error.generic'): { key: string; details: string } {
  const details = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err);
  if (err instanceof ProjectFormatError) {
    if (err.message === 'newer-version') return { key: 'error.projectNewer', details };
    if (['not-a-zip', 'missing-project-json', 'bad-format-id', 'invalid-json'].includes(err.message)) return { key: 'error.notProject', details };
    return { key: 'error.openProject', details };
  }
  const name = (err as { name?: string })?.name;
  if (name === 'QuotaExceededError' || /quota/i.test(String((err as Error)?.message))) return { key: 'error.storageFull', details };
  if (name === 'EncodingError' || /decode/i.test(String((err as Error)?.message))) return { key: fallbackKey === 'error.generic' ? 'error.imageDecode' : fallbackKey, details };
  return { key: fallbackKey, details };
}

export const isCancel = (e: unknown): boolean => e instanceof CancelledError;
