import { describe, expect, it } from 'vitest';
import { History, ValueCommand, CompositeCommand, type Command } from '../../src/core/history/History';

function counterCmd(state: { v: number }, delta: number, bytes = 10, disposed?: string[], name = ''): Command {
  state.v += delta;
  return {
    label: 'add',
    bytes,
    undo: () => void (state.v -= delta),
    redo: () => void (state.v += delta),
    dispose: () => disposed?.push(name),
  };
}

describe('History', () => {
  it('undoes and redoes in order', async () => {
    const s = { v: 0 };
    const h = new History();
    h.push(counterCmd(s, 1));
    h.push(counterCmd(s, 10));
    expect(s.v).toBe(11);
    await h.undo();
    expect(s.v).toBe(1);
    await h.undo();
    expect(s.v).toBe(0);
    expect(await h.undo()).toBe(false);
    await h.redo();
    await h.redo();
    expect(s.v).toBe(11);
    expect(h.state().canRedo).toBe(false);
  });

  it('clears the redo stack on a new action and disposes it', async () => {
    const s = { v: 0 };
    const disposed: string[] = [];
    const h = new History();
    h.push(counterCmd(s, 1, 10, disposed, 'a'));
    h.push(counterCmd(s, 2, 10, disposed, 'b'));
    await h.undo();
    h.push(counterCmd(s, 5, 10, disposed, 'c'));
    expect(disposed).toEqual(['b']);
    expect(h.state().canRedo).toBe(false);
    expect(s.v).toBe(6);
  });

  it('respects step and memory budgets', () => {
    const s = { v: 0 };
    const disposed: string[] = [];
    const h = new History({ maxSteps: 3, maxBytes: 1000 });
    for (let i = 0; i < 5; i++) h.push(counterCmd(s, 1, 10, disposed, String(i)));
    expect(h.state().size).toBe(3);
    expect(disposed).toEqual(['0', '1']);
    h.push(counterCmd(s, 1, 2000, disposed, 'big'));
    expect(h.state().size).toBe(1); // the newest step is always kept
  });

  it('merges consecutive value changes within the window', async () => {
    let value = 0;
    const set = (v: number) => (value = v);
    const h = new History({ mergeWindowMs: 1000 });
    let t = 0;
    h.now = () => t;
    h.push(new ValueCommand('opacity', 0, 1, set, 'op'));
    t = 500;
    h.push(new ValueCommand('opacity', 1, 2, set, 'op'));
    t = 3000;
    h.push(new ValueCommand('opacity', 2, 3, set, 'op'));
    value = 3;
    expect(h.state().size).toBe(2);
    await h.undo();
    expect(value).toBe(2);
    await h.undo();
    expect(value).toBe(0);
  });

  it('runs composite commands in reverse on undo', async () => {
    const log: string[] = [];
    const mk = (n: string): Command => ({ label: n, bytes: 1, undo: () => void log.push('u' + n), redo: () => void log.push('r' + n) });
    const h = new History();
    h.push(new CompositeCommand('group', [mk('1'), mk('2')]));
    await h.undo();
    await h.redo();
    expect(log).toEqual(['u2', 'u1', 'r1', 'r2']);
  });

  it('serialises concurrent async undo calls', async () => {
    const s = { v: 0 };
    const h = new History();
    const slow = (d: number): Command => {
      s.v += d;
      return { label: 'x', bytes: 1, undo: async () => { await new Promise((r) => setTimeout(r, 5)); s.v -= d; }, redo: () => void (s.v += d) };
    };
    h.push(slow(1));
    h.push(slow(2));
    await Promise.all([h.undo(), h.undo()]);
    expect(s.v).toBe(0);
  });
});
