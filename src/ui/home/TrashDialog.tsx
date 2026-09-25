import { ArchiveRestore, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ProjectMeta } from '../../core/model/types';
import { getRepo } from '../../app/services';
import { relativeDate, useT } from '../../i18n';
import { Dialog } from '../components/Dialog';
import { dialogs } from '../components/dialogs';
import { Button, IconButton } from '../components/ui';

export function TrashDialog({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const t = useT();
  const [items, setItems] = useState<ProjectMeta[]>([]);
  const refresh = async () => {
    setItems(await (await getRepo()).listTrash());
    onChanged?.();
  };
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <Dialog
      title={t('trash.title')}
      onClose={onClose}
      testId="trash-dialog"
      footer={
        <>
          <Button
            variant="danger"
            icon={Trash2}
            disabled={!items.length}
            onClick={async () => {
              if (!(await dialogs.confirm(t('trash.title'), t('trash.confirmEmpty'), t('trash.emptyAll'), true))) return;
              const repo = await getRepo();
              for (const m of items) await repo.deletePermanently(m.id);
              await refresh();
            }}
          >
            {t('trash.emptyAll')}
          </Button>
          <Button onClick={onClose}>{t('common.close')}</Button>
        </>
      }
    >
      <div className="small muted">{t('trash.retention')}</div>
      {items.length === 0 && <div className="empty-state">{t('trash.empty')}</div>}
      {items.map((m) => (
        <div key={m.id} className="row list-row">
          <div className="grow">
            <div className="ellipsis" style={{ fontWeight: 600 }}>
              {m.name}
            </div>
            <div className="small muted">{t('trash.deletedOn', { date: relativeDate(m.deletedAt ?? 0, t) })}</div>
          </div>
          <IconButton
            icon={ArchiveRestore}
            label={t('trash.restore')}
            onClick={async () => {
              await (await getRepo()).restore(m.id);
              await refresh();
            }}
          />
          <IconButton
            icon={Trash2}
            danger
            label={t('trash.deleteForever')}
            onClick={async () => {
              if (!(await dialogs.confirm(t('trash.title'), t('trash.confirmDelete', { name: m.name }), t('common.delete'), true))) return;
              await (await getRepo()).deletePermanently(m.id);
              await refresh();
            }}
          />
        </div>
      ))}
    </Dialog>
  );
}
