import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { storage } from './db';
import { Journal } from './journal';
import { document, plan } from './test-fixtures';
import type { SyncResult, WorkoutWrite } from './types';

function result(request: WorkoutWrite, git: 'committed' | 'failed' = 'committed'): SyncResult {
  return { saved: true, changed: true, workout: { ...document(request.date, 'b'.repeat(32)), exercises: request.exercises },
    git: { status: git, commit: null, error: git === 'failed' ? 'Git failed' : null } };
}
const remote = () => ({ plan: vi.fn(async () => plan), list: vi.fn(async () => [document()]),
  get: vi.fn(async () => document('2026-09-22', 'c'.repeat(32))),
  save: vi.fn(async (request: WorkoutWrite) => result(request)),
  delete: vi.fn(async (day: string) => ({ deleted: true as const, date: day,
    git: { status: 'committed' as const, commit: null, error: null } })),
  progress: vi.fn(async () => []) });

describe('local storage and synchronization', () => {
  let db: ReturnType<typeof storage>;
  let server: ReturnType<typeof remote>;
  let journal: Journal;
  beforeEach(async () => {
    db = storage(`test-${crypto.randomUUID()}`); server = remote(); journal = new Journal(db, server);
    await journal.init(); journal.ensure('2026-09-22'); await journal.flush();
  });
  it('stores exercise photos locally and restores them after reopening', async () => {
    const source = new Blob(['photo'], { type: 'image/jpeg' });
    journal.setPhoto('hack_squat_machine', source);
    await journal.flush();
    const reopened = new Journal(db, server);
    await reopened.init();
    expect(await reopened.state.photos.hack_squat_machine.text()).toBe('photo');
    reopened.removePhoto('hack_squat_machine');
    await reopened.flush();
    const empty = new Journal(db, server);
    await empty.init();
    expect(empty.state.photos.hack_squat_machine).toBeUndefined();
  });
  it('does not send a workout when opening or editing; reopens offline with local input intact', async () => {
    journal.edit('2026-09-22', d => { d.exercises[0].sets[0].value = ','; });
    await journal.flush();
    expect(server.save).not.toHaveBeenCalled();
    server.plan.mockRejectedValue(new TypeError('offline'));
    const reopened = new Journal(db, server); await reopened.init();
    expect(reopened.state.drafts['2026-09-22'].exercises[0].sets[0].value).toBe(',');
    expect(reopened.state.connection).toBe('offline');
  });
  it('keeps edits made while a previous snapshot is in flight', async () => {
    let resolve!: (value: SyncResult) => void;
    let sent!: WorkoutWrite;
    server.save.mockImplementation(request => { sent = request; return new Promise(done => { resolve = done; }); });
    const syncing = journal.sync('2026-09-22');
    journal.edit('2026-09-22', d => { d.exercises[0].sets[0].value = '30'; });
    resolve(result(sent)); await syncing; await journal.flush();
    const draft = journal.state.drafts['2026-09-22'];
    expect(draft.exercises[0].sets[0].value).toBe('30');
    expect(draft.dirty).toBe(true);
    expect(draft.baseRevision).toBe('b'.repeat(32));
    expect(journal.state.documents['2026-09-22'].exercises[0].sets[0].value).toBe(23.5);
  });
  it('retains a draft after failed synchronization and retries only when asked', async () => {
    server.save.mockRejectedValueOnce(new TypeError('offline'));
    await journal.sync('2026-09-22');
    expect(journal.state.drafts['2026-09-22'].dirty).toBe(true);
    expect(server.save).toHaveBeenCalledTimes(1);
    await journal.sync('2026-09-22');
    expect(journal.state.drafts['2026-09-22'].dirty).toBe(false);
    expect(server.save).toHaveBeenCalledTimes(2);
  });
  it('does not mistake a Git failure for failed JSON storage', async () => {
    server.save.mockImplementationOnce(async request => result(request, 'failed'));
    await journal.sync('2026-09-22');
    expect(journal.state.drafts['2026-09-22']).toMatchObject({ dirty: false, gitPending: true, baseRevision: 'b'.repeat(32) });
    await journal.sync('2026-09-22');
    expect(journal.state.drafts['2026-09-22'].gitPending).toBe(false);
  });
  it('requires explicit conflict resolution and sends the newly fetched revision', async () => {
    server.save.mockRejectedValueOnce(new ApiError(409, 'conflict'));
    await journal.sync('2026-09-22');
    expect(journal.state.conflict?.server.revision).toBe('c'.repeat(32));
    expect(journal.state.drafts['2026-09-22'].baseRevision).toBe(null);
    expect(server.save).toHaveBeenCalledTimes(1);
    await journal.keepLocal();
    expect(server.save.mock.calls[1][0].expected_revision).toBe('c'.repeat(32));
    expect(journal.state.conflict).toBe(null);
  });
  it('cancelling a conflict keeps the local draft and does not retry or overwrite the server', async () => {
    server.save.mockRejectedValueOnce(new ApiError(409, 'conflict'));
    await journal.sync('2026-09-22');
    const localBefore = journal.state.drafts['2026-09-22'];
    journal.cancelConflict();
    expect(journal.state.conflict).toBe(null);
    expect(journal.state.drafts['2026-09-22']).toEqual(localBefore);
    expect(server.save).toHaveBeenCalledTimes(1);
  });
  it('reports quota failures rather than claiming the data was saved locally', async () => {
    const put = vi.spyOn(db, 'draft').mockRejectedValue(new DOMException('Full', 'QuotaExceededError'));
    journal.edit('2026-09-22', d => { d.exercises[0].sets[0].value = '31'; });
    await journal.flush();
    expect(journal.state.localError).toBeTruthy();
    expect(journal.state.pendingWrites).toBe(0);
    put.mockRestore(); await journal.retryLocal();
    expect(journal.state.localError).toBe(null);
    expect((await db.load()).drafts.find(d => d.date === '2026-09-22')?.exercises[0].sets[0].value).toBe('31');
  });
  it('drops cached server workouts missing from the authoritative refresh list', async () => {
    server.list.mockResolvedValue([document('2026-09-22', 'e'.repeat(32))]);
    await journal.refresh();
    expect(Object.keys(journal.state.documents)).toEqual(['2026-09-22']);
  });
  it('refreshes clean server versions without replacing unsynchronized edits', async () => {
    journal.ensure('2026-09-21');
    journal.edit('2026-09-22', d => { d.exercises[0].sets[0].value = '27'; });
    server.list.mockResolvedValue([document('2026-09-21', 'd'.repeat(32)), document('2026-09-22')]);
    await journal.refresh();
    expect(journal.state.drafts['2026-09-21'].baseRevision).toBe('d'.repeat(32));
    expect(journal.state.drafts['2026-09-22'].exercises[0].sets[0].value).toBe('27');
  });
  it('deletes a local-only draft without contacting the server', async () => {
    await journal.delete('2026-09-22');
    await journal.flush();
    expect(journal.state.drafts['2026-09-22']).toBeUndefined();
    expect(server.delete).not.toHaveBeenCalled();
    expect((await db.load()).drafts).toHaveLength(0);
  });
  it('deletes a saved workout from state and local storage', async () => {
    await journal.delete('2026-09-21');
    await journal.flush();
    expect(server.delete).toHaveBeenCalledWith('2026-09-21', 'a'.repeat(32));
    expect(journal.state.documents['2026-09-21']).toBeUndefined();
    expect((await db.load()).documents).toHaveLength(0);
  });
});
