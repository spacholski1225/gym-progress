import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, ChevronRight, Dumbbell, History, ChartNoAxesCombined, RefreshCw, Plus, Minus, Check, WifiOff, Download } from 'lucide-react';
import { api } from './api';
import { formatDay, isDay, parseInput, progress, shiftDay, today } from './domain';
import type { Journal } from './journal';
import { trainingPlans } from './plans';
import type { Draft, InputExercise, Plan, Series, Unit, Workout } from './types';
import { Plot } from './Plot';

function readRoute() {
  const [page, first, second, third] = location.hash.slice(2).split('/');
  const hasPlan = page === 'workout' && ['A', 'B', 'C'].includes(first);
  const planId = hasPlan ? first : 'A';
  const day = hasPlan ? second : first;
  return { page: ['plans', 'history', 'progress'].includes(page) ? page : page ? 'workout' : 'plans',
    planId, day: day && isDay(day) ? day : today(), exercise: (hasPlan ? third : second) ?? null };
}
function navigate(path: string) { location.hash = `/${path}`; }
function download(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function summary(exercise: InputExercise) {
  const rows = exercise.sets.map(set => `${set.reps || '—'} × ${set.value || '—'} ${exercise.unit}`);
  const amounts = [...new Set(rows)];
  return `${rows.length} ${rows.length === 1 ? 'seria' : rows.length < 5 ? 'serie' : 'serii'} · ${amounts.length === 1 ? amounts[0] : rows.slice(0, 3).join(' / ') + (rows.length > 3 ? ` / +${rows.length - 3}` : '')}`;
}

export function App({ journal, updateAvailable, applyUpdate }: {
  journal: Journal; updateAvailable: boolean; applyUpdate: () => void;
}) {
  const state = useSyncExternalStore(journal.subscribe, journal.snapshot);
  const [route, setRoute] = useState(readRoute);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const restoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    const scrollTop = () => { window.requestAnimationFrame(() => window.scrollTo(0, 0)); };
    const change = () => { setRoute(readRoute()); journal.clearMessage(); scrollTop(); };
    const online = () => { void journal.refresh(); };
    window.addEventListener('hashchange', change); window.addEventListener('online', online);
    return () => {
      window.removeEventListener('hashchange', change); window.removeEventListener('online', online);
      window.history.scrollRestoration = restoration;
    };
  }, [journal]);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [route.page, route.day, route.exercise]);
  useEffect(() => {
    if (!state.ready || route.page !== 'workout') return;
    if ((state.plan?.plan_id ?? 'A') !== route.planId) {
      void journal.selectPlan(route.planId);
      return;
    }
    journal.ensure(route.day);
  }, [journal, route.page, route.planId, route.day, state.ready, state.plan?.plan_id]);
  const draft = state.drafts[route.day];
  const exerciseIndex = draft?.exercises.findIndex(e => e.exercise_id === route.exercise) ?? -1;
  const detail = route.page === 'workout' && exerciseIndex >= 0;
  const syncing = state.syncing.includes(route.day);
  const selectedPlan = trainingPlans.find(plan => plan.id === route.planId);
  const title = detail ? draft.exercises[exerciseIndex].name
    : route.page === 'plans' ? 'Plany treningowe'
    : route.page === 'history' ? 'Historia'
    : route.page === 'progress' ? 'Postępy' : selectedPlan?.title ?? 'Plan treningowy';
  const exportAll = () => download({ plan: state.plan, drafts: state.drafts, workouts: state.documents }, `trening-kopia-${today()}.json`);

  return <div className={`app ${detail ? 'detail-mode' : ''}`}>
    <header className="header">
      {route.page !== 'plans' && <button className="back" onClick={() => navigate('plans')}><ArrowLeft size={18} /> Wybór planu</button>}
      <div className="title-row"><h1 ref={heading} tabIndex={-1}>{title}</h1>
        {!detail && <button className="icon-button" aria-label="Odśwież dane z serwera" disabled={state.connection === 'checking'} onClick={() => void journal.refresh()}><RefreshCw size={19} className={state.connection === 'checking' ? 'spin' : ''} /></button>}
      </div>
      {detail ? <p className="muted">Ćwiczenie {exerciseIndex + 1} z {draft.exercises.length} · {formatDay(route.day, true)}</p>
        : route.page === 'workout' && <><p className="muted plan-context">Plan {route.planId}</p><div className="date-row"><label htmlFor="workout-day">Dzień treningu</label>
          <input id="workout-day" aria-label="Dzień treningu" type="date" value={route.day} max={today()} onChange={event => { if (isDay(event.target.value)) navigate(`workout/${route.planId}/${event.target.value}`); }} /></div></>}
      {!detail && state.connection === 'offline' && <p className="connection"><WifiOff size={15} /> Serwer niedostępny · dane z telefonu</p>}
      {!detail && route.page === 'workout' && draft?.copiedFrom && <p className="muted source">Wartości z treningu · {formatDay(draft.copiedFrom, true)}</p>}
    </header>

    <main>
      {updateAvailable && <aside className="notice"><p>Dostępna jest nowa wersja aplikacji.</p><button className="text-button" disabled={state.pendingWrites > 0 || state.syncing.length > 0 || !!state.localError} onClick={applyUpdate}>Uruchom ponownie</button></aside>}
      {!state.ready && <p className="empty" role="status">Otwieranie dziennika…</p>}
      {state.ready && route.page === 'plans' && <PlansView ready={!!state.plan} plan={state.plan} documents={state.documents} onSelect={planId => navigate(`workout/${planId}/${today()}`)} />}
      {draft && route.page === 'workout' && (detail
        ? <ExerciseEditor draft={draft} index={exerciseIndex} journal={journal} />
        : <div className="exercise-list">{draft.exercises.map((exercise, i) => <button key={exercise.exercise_id} className="exercise-card" onClick={() => navigate(`workout/${route.planId}/${route.day}/${exercise.exercise_id}`)}>
          <span className="exercise-number">{String(i + 1).padStart(2, '0')}</span><span className="exercise-description"><strong>{exercise.name}</strong><span>{summary(exercise)}</span></span><ChevronRight size={18} aria-hidden="true" />
        </button>)}</div>)}
      {state.ready && route.page === 'history' && <HistoryView journal={journal} planId={route.planId} onExport={exportAll} />}
      {state.ready && route.page === 'progress' && <ProgressView journal={journal} />}
    </main>

    {draft && route.page === 'workout' && <div className={`save-bar ${detail ? 'detail-save' : ''}`}>
      <button className="primary" disabled={!detail && (syncing || (!draft.dirty && !draft.gitPending))} onClick={() => detail ? navigate(`workout/${route.planId}/${route.day}`) : void journal.sync(route.day)}>
        {detail ? 'Gotowe · wróć do listy' : syncing ? <><RefreshCw className="spin" size={19} /> Synchronizowanie…</> : !draft.dirty && !draft.gitPending ? <><Check size={19} /> Zsynchronizowano</> : 'Synchronizuj trening'}
      </button>
      <p className="save-status" role="status">{state.localError ? 'Problem z zapisem na telefonie' : state.pendingWrites > 0 ? 'Zapisywanie na telefonie…' : detail ? 'Zmiany zapisane na telefonie' : draft.gitPending ? 'Trening na serwerze · ponów zapis historii zmian' : draft.dirty ? 'Na telefonie · do synchronizacji' : 'Trening zapisany na serwerze'}</p>
    </div>}
    {!detail && <nav className="navigation" aria-label="Główna nawigacja">
      <a href="#/plans" aria-current={route.page === 'plans' ? 'page' : undefined}><Dumbbell size={22} /><span>Trening</span></a>
      <a href="#/history" aria-current={route.page === 'history' ? 'page' : undefined}><History size={22} /><span>Historia</span></a>
      <a href="#/progress" aria-current={route.page === 'progress' ? 'page' : undefined}><ChartNoAxesCombined size={22} /><span>Postępy</span></a>
    </nav>}
    {state.conflict && <Conflict journal={journal} />}
  </div>;
}

function PlansView({ ready, plan, documents, onSelect }: {
  ready: boolean; plan: Plan | null; documents: Record<string, Workout>; onSelect: (planId: string) => void;
}) {
  const planIds = plan?.exercises.map(exercise => exercise.exercise_id).join(':');
  const lastWorkout = Object.values(documents)
    .filter(workout => workout.exercises.map(exercise => exercise.exercise_id).join(':') === planIds)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return <section className="plans-view" aria-label="Wybór planu treningowego">
    <div className="plans-intro">
      <p className="eyebrow">Twój dziennik</p>
      <h2>Wybierz plan</h2>
      <p className="muted">Wybierz gotowy plan treningowy. Kolejne plany pojawią się tutaj, gdy ich ćwiczenia będą ustalone.</p>
    </div>
    <div className="plans-dashboard">
      <div className="plan-list">
        {trainingPlans.map(plan => {
          const available = plan.status === 'ready' && ready;
          return <button key={plan.id} className={`plan-card ${plan.status}`} disabled={!available} onClick={plan.status === 'ready' ? () => onSelect(plan.id) : undefined}
            aria-label={`${plan.title}: ${plan.status === 'ready' ? 'otwórz' : 'w przygotowaniu'}`}>
            <span className="plan-label">PLAN {plan.id}</span>
            <strong>{plan.title}</strong>
            <span className="plan-description">{plan.description}</span>
            <span className="plan-action">{plan.status === 'ready' ? (ready ? 'Otwórz plan' : 'Ładowanie planu…') : 'W przygotowaniu'} {plan.status === 'ready' && <ChevronRight size={17} />}</span>
          </button>;
        })}
      </div>
      <aside className="last-workout" aria-label="Ostatni zapisany trening">
        <span className="eyebrow">Ostatni zapisany trening</span>
        {lastWorkout ? <><strong>Trening</strong><time dateTime={lastWorkout.date}>{formatDay(lastWorkout.date)}</time></>
          : <p className="muted">Brak zapisanych treningów.</p>}
      </aside>
    </div>
    <p className="muted plans-footnote">Harmonogram kolejnych treningów nie jest jeszcze wyznaczany.</p>
  </section>;
}

function ExerciseEditor({ draft, index, journal }: { draft: Draft; index: number; journal: Journal }) {
  const exercise = draft.exercises[index];
  const edit = (transform: (value: InputExercise) => void) => journal.edit(draft.date, d => transform(d.exercises[index]));
  return <section className="editor" aria-label={`Serie: ${exercise.name}`}>
    <div className="set-head"><span>Seria</span><span>{exercise.unit === 'kg' ? 'Ciężar · kg' : 'Czas · sec'}</span><span>Powtórzenia</span></div>
    {exercise.sets.map((set, i) => <div className="set-row" key={i}><span className="set-number">Seria {i + 1}</span>
      {(['value', 'reps'] as const).map(field => {
        let error = ''; try { parseInput(set[field], field); } catch (e) { error = (e as Error).message; }
        const label = `${exercise.name}, seria ${i + 1}, ${field === 'value' ? exercise.unit : 'powtórzenia'}`;
        return <div className="input-wrap" key={field}><input type="text" inputMode={field === 'value' ? 'decimal' : 'numeric'} autoComplete="off" enterKeyHint="next" aria-label={label} aria-invalid={!!error} aria-describedby={error ? `error-${i}-${field}` : undefined}
          value={set[field]} placeholder="—" onFocus={event => event.target.select()} onChange={event => edit(e => { e.sets[i][field] = event.target.value; })} />
          {error && <span className="input-error" id={`error-${i}-${field}`}>{error}</span>}</div>;
      })}</div>)}
    <div className="actions series-actions"><button className="text-button" onClick={() => edit(e => { e.sets.push({ value: '', reps: '' }); })}><Plus size={17} /> Dodaj serię</button>
      <button className="text-button" disabled={exercise.sets.length === 1} onClick={() => {
        const last = exercise.sets.at(-1)!;
        if ((last.value || last.reps) && !window.confirm('Usunąć ostatnią serię wraz z jej wartościami?')) return;
        edit(e => { e.sets.pop(); });
      }}><Minus size={17} /> Usuń ostatnią</button></div>
    <div className="unit-row"><label htmlFor="exercise-unit">Jednostka ćwiczenia</label><select id="exercise-unit" value={exercise.unit} onChange={event => {
      const unit = event.target.value as Unit;
      if (exercise.sets.some(s => s.value !== '') && !window.confirm('Zmiana jednostki wyczyści wartości ciężaru lub czasu. Powtórzenia zostaną zachowane. Kontynuować?')) return;
      edit(e => { e.unit = unit; e.sets.forEach(s => { s.value = ''; }); });
    }}><option value="kg">kg</option><option value="sec">sec</option></select></div>
  </section>;
}

function HistoryView({ journal, planId, onExport }: { journal: Journal; planId: string; onExport: () => void }) {
  const state = useSyncExternalStore(journal.subscribe, journal.snapshot);
  const dates = [...new Set([...Object.keys(state.documents), ...Object.keys(state.drafts)])].sort().reverse();
  return <section aria-label="Zapisane treningi">
    {!dates.length && <p className="empty">Tutaj pojawią się Twoje treningi i lokalne wersje robocze.</p>}
    <div className="history-list">{dates.map(day => {
      const draft = state.drafts[day];
      return <button className="history-card" key={day} onClick={() => navigate(`workout/${planId}/${day}`)}><span><strong>{formatDay(day)}</strong><small>{draft?.dirty ? 'Zmiany tylko na telefonie' : draft?.gitPending ? 'Na serwerze · ponów historię zmian' : 'Zapisany na serwerze'}</small></span><ChevronRight size={18} /></button>;
    })}</div>
    <button className="text-button export" onClick={onExport}><Download size={17} /> Pobierz kopię danych z telefonu</button>
    <p className="muted footnote">Historia obejmuje zapisane treningi i wersje robocze dostępne na tym urządzeniu.</p>
  </section>;
}

function ProgressView({ journal }: { journal: Journal }) {
  const state = useSyncExternalStore(journal.subscribe, journal.snapshot);
  const [days, setDays] = useState<30 | 90>(30);
  const [end, setEnd] = useState(today());
  const start = shiftDay(end, -(days - 1));
  const [remote, setRemote] = useState<{ key: string; series: Series[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const key = `${start}:${end}`;
  useEffect(() => {
    let active = true;
    setRemote(null); setLoading(true);
    api.progress(start, end).then(series => { if (active) setRemote({ key, series }); }).catch(() => {}).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [key, start, end, state.documents]);
  const series = remote?.key === key ? remote.series : progress(Object.values(state.documents), start, end);
  const displayed = [...series];
  for (const exercise of state.plan?.exercises ?? []) {
    if (!series.some(s => s.exercise_id === exercise.exercise_id && s.unit === exercise.unit)) displayed.push({ ...exercise, points: [] });
  }
  displayed.sort((a, b) => (state.plan?.exercises.findIndex(e => e.exercise_id === a.exercise_id) ?? 0) - (state.plan?.exercises.findIndex(e => e.exercise_id === b.exercise_id) ?? 0));
  return <section aria-label="Wykresy postępów">
    <div className="segmented" aria-label="Zakres wykresów">{([30, 90] as const).map(n => <button key={n} aria-pressed={days === n} onClick={() => setDays(n)}>Ostatnie {n} dni</button>)}</div>
    <div className="date-row period"><label htmlFor="period-end">Do dnia</label><input id="period-end" type="date" value={end} max={today()} onChange={e => { if (isDay(e.target.value)) setEnd(e.target.value); }} /></div>
    <p className="muted footnote">{formatDay(start, true)} – {formatDay(end, true)} · największa wartość z serii. {loading ? 'Odświeżanie…' : remote ? 'Dane z serwera.' : 'Zapisane dane z telefonu.'} Niezsynchronizowane zmiany nie są uwzględniane.</p>
    <div className="charts">{displayed.map(s => <Plot key={`${s.exercise_id}:${s.unit}`} series={s} start={start} end={end} />)}</div>
    {!displayed.length && <p className="empty">Brak zapisanych danych w tym zakresie.</p>}
  </section>;
}

function Conflict({ journal }: { journal: Journal }) {
  const state = useSyncExternalStore(journal.subscribe, journal.snapshot);
  const conflict = state.conflict!;
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); return () => { dialog.current?.close(); }; }, []);
  return <dialog ref={dialog} className="conflict" aria-labelledby="conflict-title" onCancel={journal.cancelConflict}>
    <h2 id="conflict-title">Dwie wersje treningu</h2><p>{formatDay(conflict.day)} ma już inną wersję na serwerze. Twoje zmiany są nadal na telefonie.</p>
    <p className="muted">Zapis serwera: {new Date(conflict.server.updated_at).toLocaleString('pl-PL')}</p>
    <button className="text-button" onClick={() => download(state.drafts[conflict.day], `trening-lokalny-${conflict.day}.json`)}><Download size={17} /> Pobierz lokalną wersję</button>
    <div className="conflict-actions"><button className="primary" onClick={() => void journal.keepLocal()}>Zapisz moją wersję na serwerze</button>
      <button className="secondary" onClick={() => { if (window.confirm('Zastąpić lokalne zmiany wersją z serwera? Możesz wcześniej pobrać lokalną kopię.')) void journal.useServer(); }}>Wczytaj wersję serwera</button>
      <button className="text-button" onClick={journal.cancelConflict}>Rozstrzygnę później</button></div>
  </dialog>;
}
