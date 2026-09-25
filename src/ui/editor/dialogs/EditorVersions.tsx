import { useEffect, useState } from 'react';
import type { ProjectMeta } from '../../../core/model/types';
import { setUi } from '../../../editor/controller';
import { closeEditor, openProject } from '../../../app/store';
import { VersionsDialog } from '../../home/VersionsDialog';
import { useSession } from '../context';

/** Versions of the open project; opening one closes the editor first (with the save prompt). */
export default function EditorVersions() {
  const s = useSession();
  const [meta, setMeta] = useState<ProjectMeta | null>(null);
  useEffect(() => {
    void s.repo.getMeta(s.doc.id).then((m) => setMeta(m ?? null));
  }, [s]);
  if (!meta) return null;
  return (
    <VersionsDialog
      meta={meta}
      onClose={() => setUi({ dialog: null })}
      onOpen={async (rev) => {
        const id = s.doc.id;
        if (await closeEditor()) await openProject(id, rev);
      }}
    />
  );
}
