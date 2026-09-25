import { useEffect, useState } from 'react';
import type { ProjectMeta } from '../../core/model/types';
import type { RevisionInfo } from '../../storage/ProjectRepository';
import { getRepo } from '../../app/services';
import { openProject } from '../../app/store';
import { useT } from '../../i18n';
import { Dialog } from '../components/Dialog';
import { Button } from '../components/ui';

export function VersionsDialog({ meta, onClose, onOpen }: { meta: ProjectMeta; onClose: () => void; onOpen?: (rev: number) => Promise<void> }) {
  const t = useT();
  const [revs, setRevs] = useState<RevisionInfo[] | null>(null);
  useEffect(() => {
    getRepo()
      .then((r) => r.listRevisions(meta.id))
      .then(setRevs)
      .catch(() => setRevs([]));
  }, [meta.id]);
  return (
    <Dialog title={`${t('versions.title')} — ${meta.name}`} onClose={onClose} testId="versions-dialog">
      <div className="small muted">{t('versions.hint')}</div>
      {revs === null && <div className="spinner" />}
      {revs?.map((r) => (
        <div key={r.rev} className="row list-row">
          <div className="grow">
            <div style={{ fontWeight: 600 }}>
              {t('versions.item', { rev: r.rev, date: new Date(r.savedAt).toLocaleString() })}
              {r.rev === meta.rev && <span className="chip on" style={{ marginLeft: 8, minHeight: 22 }}>{t('versions.current')}</span>}
            </div>
            <div className="small muted">{t('versions.detail', { frames: r.frameCount, layers: r.layerCount })}</div>
          </div>
          <Button
            small
            onClick={async () => {
              onClose();
              if (onOpen) await onOpen(r.rev);
              else await openProject(meta.id, r.rev);
            }}
          >
            {t('versions.open')}
          </Button>
        </div>
      ))}
    </Dialog>
  );
}
