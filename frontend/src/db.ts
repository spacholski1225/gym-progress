import { openDB, type DBSchema } from 'idb';
import type { Draft, ExercisePhoto, Plan, Workout } from './types';

interface JournalDB extends DBSchema {
  drafts: { key: string; value: Draft };
  documents: { key: string; value: Workout };
  settings: { key: string; value: Plan };
  photos: { key: string; value: ExercisePhoto };
}
export function storage(name = 'training-journal-v1'): Storage {
  const database = openDB<JournalDB>(name, 2, { upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      db.createObjectStore('drafts', { keyPath: 'date' });
      db.createObjectStore('documents', { keyPath: 'date' });
      db.createObjectStore('settings');
    }
    if (oldVersion < 2) db.createObjectStore('photos', { keyPath: 'exercise_id' });
  } });
  return {
    async load() {
      const db = await database;
      const [drafts, documents, plan, photos] = await Promise.all([
        db.getAll('drafts'), db.getAll('documents'), db.get('settings', 'plan'), db.getAll('photos'),
      ]);
      return { drafts, documents, plan: plan ?? null, photos };
    },
    async draft(value: Draft) { await (await database).put('drafts', value); },
    async deleteDraft(date: string) { await (await database).delete('drafts', date); },
    async deleteDocument(date: string) { await (await database).delete('documents', date); },
    async plan(value: Plan) { await (await database).put('settings', value, 'plan'); },
    async photo(value: ExercisePhoto) { await (await database).put('photos', value); },
    async deletePhoto(exerciseId: string) { await (await database).delete('photos', exerciseId); },
    async documents(values: Workout[]) {
      const tx = (await database).transaction('documents', 'readwrite');
      await Promise.all([...values.map(value => tx.store.put(value)), tx.done]);
    },
    async replaceDocuments(values: Workout[]) {
      const tx = (await database).transaction('documents', 'readwrite');
      await tx.store.clear();
      await Promise.all([...values.map(value => tx.store.put(value)), tx.done]);
    },
  };
}
export type StoredData = { drafts: Draft[]; documents: Workout[]; plan: Plan | null; photos: ExercisePhoto[] };
export interface Storage {
  load(): Promise<StoredData>;
  draft(value: Draft): Promise<void>;
  deleteDraft(date: string): Promise<void>;
  deleteDocument(date: string): Promise<void>;
  plan(value: Plan): Promise<void>;
  photo(value: ExercisePhoto): Promise<void>;
  deletePhoto(exerciseId: string): Promise<void>;
  documents(values: Workout[]): Promise<void>;
  replaceDocuments(values: Workout[]): Promise<void>;
}
