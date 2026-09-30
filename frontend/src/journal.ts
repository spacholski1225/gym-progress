import { api, ApiError } from './api';
import { fromWorkout, newDraft, toRequest, today } from './domain';
import type { Storage } from './db';
import type { Draft, Plan, Workout } from './types';

type State = {
  ready: boolean; plan: Plan | null; drafts: Record<string, Draft>; documents: Record<string, Workout>;
  connection: 'checking' | 'available' | 'offline'; pendingWrites: number; localError: string | null;
  message: string | null; syncing: string[]; conflict: { day: string; server: Workout } | null;
};
function draftMatchesPlan(draft: Draft, plan: Plan): boolean {
  return draft.exercises.length === plan.exercises.length &&
    draft.exercises.every((exercise, i) => {
      const definition = plan.exercises[i];
      return exercise.exercise_id === definition.exercise_id && exercise.name === definition.name && exercise.unit === definition.unit;
    });
}
export class Journal {
  state: State = { ready: false, plan: null, drafts: {}, documents: {}, connection: 'checking',
    pendingWrites: 0, localError: null, message: null, syncing: [], conflict: null };
  private listeners = new Set<() => void>();
  private queue: Promise<void> = Promise.resolve();
  private refreshing = false;
  constructor(private db: Storage, private remote = api) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  private emit(patch: Partial<State>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  private persist(action: () => Promise<unknown>) {
    this.emit({ pendingWrites: this.state.pendingWrites + 1 });
    this.queue = this.queue.then(action).then(() => {
      this.emit({ pendingWrites: this.state.pendingWrites - 1 });
    }, () => {
      this.emit({ pendingWrites: this.state.pendingWrites - 1,
        localError: 'Nie udało się zapisać danych na telefonie. Nie zamykaj aplikacji; pobierz kopię lub ponów zapis.' });
    });
  }
  flush = () => this.queue;
  async retryLocal() {
    // Rewrite every current draft, not only the last failed field update.
    this.emit({ localError: null });
    for (const draft of Object.values(this.state.drafts)) this.persist(() => this.db.draft(draft));
    if (this.state.plan) { const plan = this.state.plan; this.persist(() => this.db.plan(plan)); }
    this.persist(() => this.db.documents(Object.values(this.state.documents)));
    await this.flush();
  }
  async init() {
    try {
      const cached = await this.db.load();
      this.emit({ plan: cached.plan, drafts: Object.fromEntries(cached.drafts.map(d => [d.date, d])),
        documents: Object.fromEntries(cached.documents.map(d => [d.date, d])), ready: true });
    } catch {
      this.emit({ ready: true, localError: 'Pamięć telefonu jest niedostępna. Nie zamykaj aplikacji przed zapisaniem danych na serwerze lub pobraniem kopii.' });
    }
    await this.refresh();
  }
  async refresh() {
    if (this.refreshing) return;
    this.refreshing = true;
    this.emit({ connection: 'checking' });
    try {
      const [plan, documents] = await Promise.all([this.remote.plan(), this.remote.list()]);
      const merged = { ...this.state.documents };
      for (const document of documents) {
        if (!merged[document.date] || merged[document.date].updated_at <= document.updated_at) {
          merged[document.date] = document;
        }
      }
      this.emit({ plan, documents: merged, connection: 'available' });
      this.persist(() => this.db.plan(plan));
      this.persist(() => this.db.documents(Object.values(merged)));
      for (const draft of Object.values(this.state.drafts)) {
        if (!draftMatchesPlan(draft, plan)) {
          this.setDraft(newDraft(draft.date, plan, Object.values(merged)));
          continue;
        }
        const document = merged[draft.date];
        if (document && !draft.dirty && !draft.gitPending && !this.state.syncing.includes(draft.date) && document.revision !== draft.baseRevision) {
          this.setDraft(fromWorkout(document, draft.generation + 1));
        }
      }
    } catch { this.emit({ connection: 'offline' }); }
    finally { this.refreshing = false; }
  }
  private setDraft(draft: Draft) {
    this.emit({ drafts: { ...this.state.drafts, [draft.date]: draft } });
    this.persist(() => this.db.draft(draft));
  }
  ensure(day: string) {
    const existingDraft = this.state.drafts[day];
    if (existingDraft) {
      const currentPlan = this.state.plan;
      if (!currentPlan) return;
      if (!draftMatchesPlan(existingDraft, currentPlan)) {
        this.setDraft(newDraft(day, currentPlan, Object.values(this.state.documents)));
      }
      return;
    }
    const existing = this.state.documents[day];
    if (existing) this.setDraft(fromWorkout(existing));
    else if (this.state.plan) this.setDraft(newDraft(day, this.state.plan, Object.values(this.state.documents)));
  }
  edit(day: string, transform: (draft: Draft) => void) {
    const draft = structuredClone(this.state.drafts[day]);
    transform(draft);
    draft.generation += 1; draft.dirty = true;
    this.setDraft(draft);
    this.emit({ message: null });
  }
  clearMessage = () => this.emit({ message: null });
  cancelConflict = () => this.emit({ conflict: null });
  async useServer() {
    const conflict = this.state.conflict;
    if (!conflict) return;
    const current = this.state.drafts[conflict.day];
    this.setDraft(fromWorkout(conflict.server, current.generation + 1));
    this.emit({ documents: { ...this.state.documents, [conflict.day]: conflict.server }, conflict: null });
    this.persist(() => this.db.documents([conflict.server]));
  }
  async keepLocal() {
    const conflict = this.state.conflict;
    if (!conflict) return;
    this.setDraft({ ...this.state.drafts[conflict.day], baseRevision: conflict.server.revision });
    this.emit({ conflict: null });
    await this.sync(conflict.day);
  }
  async sync(day: string) {
    if (this.state.syncing.includes(day)) return;
    const snapshot = structuredClone(this.state.drafts[day]);
    if (!snapshot) return;
    let request;
    try { request = toRequest(snapshot); }
    catch (error) { this.emit({ message: (error as Error).message }); return; }
    this.emit({ syncing: [...this.state.syncing, day], message: null });
    try {
      const response = await this.remote.save(request);
      const latest = this.state.drafts[day];
      this.emit({ documents: { ...this.state.documents, [day]: response.workout }, connection: 'available' });
      this.persist(() => this.db.documents([response.workout]));
      this.setDraft({ ...latest, baseRevision: response.workout.revision,
        dirty: latest.generation !== snapshot.generation, gitPending: response.git.status === 'failed' });
      if (response.git.status === 'failed') this.emit({ message: 'Trening jest na serwerze, ale zapis historii zmian nie powiódł się. Ponów synchronizację.' });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        try { this.emit({ conflict: { day, server: await this.remote.get(day) } }); }
        catch { this.emit({ message: 'Wykryto inną wersję, ale nie można jej pobrać. Twoje zmiany pozostają na telefonie. Spróbuj ponownie.' }); }
      } else {
        this.emit({ connection: error instanceof ApiError ? 'available' : 'offline',
          message: error instanceof ApiError ? error.message : 'Nie udało się potwierdzić zapisu. Sprawdź VPN i ponów synchronizację. Twoje zmiany pozostają na telefonie.' });
      }
    } finally { this.emit({ syncing: this.state.syncing.filter(d => d !== day) }); }
  }
}
