import { useState } from 'react';
import { create } from 'zustand';
import { useT } from '../../i18n';
import { Dialog } from './Dialog';
import { Button } from './ui';

interface Choice {
  label: string;
  value: string;
  variant?: 'primary' | 'danger' | 'default' | 'ghost';
}

type Request =
  | { kind: 'confirm'; title: string; message: string; confirm: string; danger?: boolean; resolve: (v: boolean) => void }
  | { kind: 'prompt'; title: string; label: string; value: string; resolve: (v: string | null) => void }
  | { kind: 'choice'; title: string; message: string; choices: Choice[]; resolve: (v: string | null) => void; dismissable: boolean }
  | { kind: 'error'; title: string; message: string; details: string; resolve: () => void };

const useDialogs = create<{ queue: Request[] }>(() => ({ queue: [] }));

function enqueue(r: Request) {
  useDialogs.setState((s) => ({ queue: [...s.queue, r] }));
}
function done() {
  useDialogs.setState((s) => ({ queue: s.queue.slice(1) }));
}

export const dialogs = {
  confirm(title: string, message: string, confirm: string, danger = false): Promise<boolean> {
    return new Promise((resolve) => enqueue({ kind: 'confirm', title, message, confirm, danger, resolve }));
  },
  prompt(title: string, label: string, value = ''): Promise<string | null> {
    return new Promise((resolve) => enqueue({ kind: 'prompt', title, label, value, resolve }));
  },
  choice(title: string, message: string, choices: Choice[], dismissable = true): Promise<string | null> {
    return new Promise((resolve) => enqueue({ kind: 'choice', title, message, choices, resolve, dismissable }));
  },
  error(title: string, message: string, details: string): Promise<void> {
    return new Promise((resolve) => enqueue({ kind: 'error', title, message, details, resolve }));
  },
};

function PromptBody({ req }: { req: Extract<Request, { kind: 'prompt' }> }) {
  const t = useT();
  const [v, setV] = useState(req.value);
  const ok = () => {
    done();
    req.resolve(v.trim() || null);
  };
  return (
    <Dialog
      title={req.title}
      size="narrow"
      onClose={() => {
        done();
        req.resolve(null);
      }}
      footer={
        <>
          <Button onClick={() => (done(), req.resolve(null))}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={ok} testId="prompt-ok">
            {t('common.ok')}
          </Button>
        </>
      }
    >
      <div className="field">
        <label>{req.label}</label>
        <input
          className="input"
          autoFocus
          value={v}
          maxLength={120}
          data-testid="prompt-input"
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') ok();
          }}
        />
      </div>
    </Dialog>
  );
}

export function ErrorBody({ message, details }: { message: string; details: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="error-box">
      <p style={{ margin: 0 }}>{message}</p>
      {details && (
        <>
          <button type="button" className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(!open)}>
            {open ? t('common.hideDetails') : t('common.details')}
          </button>
          {open && <pre>{details}</pre>}
        </>
      )}
    </div>
  );
}

/** Renders the dialog at the head of the queue. */
export function DialogHost() {
  const t = useT();
  const req = useDialogs((s) => s.queue[0]);
  if (!req) return null;
  if (req.kind === 'confirm')
    return (
      <Dialog
        title={req.title}
        size="narrow"
        testId="confirm-dialog"
        onClose={() => (done(), req.resolve(false))}
        footer={
          <>
            <Button onClick={() => (done(), req.resolve(false))}>{t('common.cancel')}</Button>
            <Button variant={req.danger ? 'danger' : 'primary'} onClick={() => (done(), req.resolve(true))} testId="confirm-ok">
              {req.confirm}
            </Button>
          </>
        }
      >
        <p style={{ margin: 0 }}>{req.message}</p>
      </Dialog>
    );
  if (req.kind === 'prompt') return <PromptBody key={req.title + req.value} req={req} />;
  if (req.kind === 'error')
    return (
      <Dialog title={req.title} size="narrow" onClose={() => (done(), req.resolve())} footer={<Button variant="primary" onClick={() => (done(), req.resolve())}>{t('common.ok')}</Button>}>
        <ErrorBody message={req.message} details={req.details} />
      </Dialog>
    );
  return (
    <Dialog
      title={req.title}
      size="narrow"
      testId="choice-dialog"
      modal={!req.dismissable}
      onClose={req.dismissable ? () => (done(), req.resolve(null)) : undefined}
      footer={
        <div className="col" style={{ width: '100%' }}>
          {req.choices.map((c) => (
            <Button key={c.value} block variant={c.variant} onClick={() => (done(), req.resolve(c.value))} testId={`choice-${c.value}`}>
              {c.label}
            </Button>
          ))}
        </div>
      }
    >
      <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{req.message}</p>
    </Dialog>
  );
}
