import { openDB, type DBSchema } from 'idb';
import type { Draft, Plan, Workout } from './types';

interface JournalDB extends DBSchema {
  drafts: { key: string; value: Draft };
  documents: { key: string; value: Workout };
  settings: { key: string; value: Plan };
}
export function storage(name = 'training-journal-v1') {
  const database = openDB<JournalDB>(name, 1, { upgrade(db) {
    db.createObjectStore('drafts', { keyPath: 'date' });
    db.createObjectStore('documents', { keyPath: 'date' });
    db.createObjectStore('settings');
  } });
  return {
    async load() {
      const db = await database;
      const [drafts, documents, plan] = await Promise.all([
        db.getAll('drafts'), db.getAll('documents'), db.get('settings', 'plan'),
      ]);
      return { drafts, documents, plan: plan ?? null };
    },
    async draft(value: Draft) { await (await database).put('drafts', value); },
    async plan(value: Plan) { await (await database).put('settings', value, 'plan'); },
    async documents(values: Workout[]) {
      const tx = (await database).transaction('documents', 'readwrite');
      await Promise.all([...values.map(value => tx.store.put(value)), tx.done]);
    },
  };
}
export type Storage = ReturnType<typeof storage>;
