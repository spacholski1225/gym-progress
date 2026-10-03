import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, ChevronRight, Dumbbell, History, ChartNoAxesCombined, RefreshCw, Plus, Minus, Check, WifiOff, Download, Timer, Info, Trash2, ImagePlus } from 'lucide-react';
import { api } from './api';
import { formatDay, isDay, parseInput, parseRest, progress, shiftDay, today } from './domain';
import type { Journal } from './journal';
import { trainingPlans } from './plans';
import type { Draft, InputExercise, Plan, Series, Unit, Workout } from './types';
import { Plot } from './Plot';

function readRoute() {
  const [page, first, second, third] = location.hash.slice(2).split('/');
  const hasPlan = page === 'workout' && ['A', 'B', 'C'].includes(first);
  const progressPlan = page === 'progress' && ['A', 'B', 'C'].includes(first) ? first : null;
  const planId = hasPlan ? first : 'A';
  const day = hasPlan ? second : first;
  return { page: ['plans', 'history', 'progress'].includes(page) ? page : page ? 'workout' : 'plans',
    planId, progressPlan, day: day && isDay(day) ? day : today(), exercise: (hasPlan ? third : second) ?? null };
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
  const rest = exercise.rest_seconds === '' ? '' : ` · ${exercise.rest_seconds} s`;
  return `${rows.length} ${rows.length === 1 ? 'seria' : rows.length < 5 ? 'serie' : 'serii'} · ${amounts.length === 1 ? amounts[0] : rows.slice(0, 3).join(' / ') + (rows.length > 3 ? ` / +${rows.length - 3}` : '')}${rest}`;
}
function usePhotoUrl(blob: Blob | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) { setUrl(null); return; }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}
async function preparePhoto(file: File): Promise<Blob> {
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    await image.decode();
    const longest = Math.max(image.naturalWidth, image.naturalHeight);
    const scale = Math.min(1, 1200 / longest);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob ?? file), 'image/jpeg', 0.84));
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(source);
  }
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
  }, [route.page, route.progressPlan, route.day, route.exercise]);
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
  const contextPlanId = route.page === 'progress' && route.progressPlan ? route.progressPlan : route.planId;
  const selectedPlan = trainingPlans.find(plan => plan.id === contextPlanId);
  const title = detail ? draft.exercises[exerciseIndex].name
    : route.page === 'plans' ? 'Plany treningowe'
    : route.page === 'history' ? 'Historia'
    : route.page === 'progress' ? (route.progressPlan ? selectedPlan?.title ?? 'Postępy' : 'Postępy')
    : selectedPlan?.title ?? 'Plan treningowy';
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
        ? <ExerciseEditor key={route.exercise} draft={draft} index={exerciseIndex} journal={journal} photo={state.photos[draft.exercises[exerciseIndex].exercise_id]} />
        : <div className="exercise-list">{draft.exercises.map((exercise, i) => <ExerciseCard key={exercise.exercise_id} exercise={exercise} number={i} photo={state.photos[exercise.exercise_id]}
          onClick={() => navigate(`workout/${route.planId}/${route.day}/${exercise.exercise_id}`)} />)}</div>)}
      {state.ready && route.page === 'history' && <HistoryView journal={journal} planId={route.planId} onExport={exportAll} />}
      {state.ready && route.page === 'progress' && (route.progressPlan ? <ProgressView journal={journal} planId={route.progressPlan} /> : <ProgressPlansView />)}
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

function ExerciseCard({ exercise, number, photo, onClick }: {
  exercise: InputExercise; number: number; photo?: Blob; onClick: () => void;
}) {
  const photoUrl = usePhotoUrl(photo);
  return <button className="exercise-card" onClick={onClick}>
    {photoUrl ? <img className="exercise-thumbnail" src={photoUrl} alt="" aria-hidden="true" />
      : <span className="exercise-number">{String(number + 1).padStart(2, '0')}</span>}
    <span className="exercise-description"><strong>{exercise.name}</strong><span>{summary(exercise)}</span></span><ChevronRight size={18} aria-hidden="true" />
  </button>;
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

function ExerciseEditor({ draft, index, journal, photo }: { draft: Draft; index: number; journal: Journal; photo?: Blob }) {
  const exercise = draft.exercises[index];
  const [instructionsOpen, setInstructionsOpen] = useState(exercise.instructions !== '' || !!photo);
  const [restOpen, setRestOpen] = useState(exercise.rest_seconds !== '');
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const photoUrl = usePhotoUrl(photo);
  const instructions = exercise.instructions ?? '';
  const rest = exercise.rest_seconds ?? '';
  const edit = (transform: (value: InputExercise) => void) => journal.edit(draft.date, d => transform(d.exercises[index]));
  let restError = '';
  try { parseRest(rest); } catch (error) { restError = (error as Error).message; }
  return <section className="editor" aria-label={`Serie: ${exercise.name}`}>
    <div className="editor-tools">
      <button type="button" className={`icon-button instruction-toggle ${instructions || photo ? 'active' : ''}`} aria-label="Pokaż instrukcję ćwiczenia"
        title="Instrukcja ćwiczenia" aria-expanded={instructionsOpen} onClick={() => setInstructionsOpen(open => !open)}><Info size={19} /></button>
      <div className="rest-row">
        <button type="button" className={`icon-button rest-toggle ${rest ? 'active' : ''}`} aria-label="Ustaw przerwę między seriami"
          title="Przerwa między seriami" aria-expanded={restOpen} onClick={() => setRestOpen(open => !open)}><Timer size={19} /></button>
        {restOpen && <div className="rest-input-wrap">
          <input id="rest-seconds" type="text" inputMode="numeric" autoComplete="off" aria-label="Przerwa między seriami w sekundach"
            aria-invalid={!!restError} aria-describedby={restError ? 'rest-seconds-error' : undefined} value={rest} placeholder="—"
            onFocus={event => event.target.select()} onChange={event => edit(e => { e.rest_seconds = event.target.value; })} />
          <span aria-hidden="true">sec</span>
          {restError && <span className="input-error" id="rest-seconds-error">{restError}</span>}
        </div>}
      </div>
    </div>
    {instructionsOpen && <div className="instruction-panel">
      <label htmlFor="exercise-instructions">Instrukcja wykonania</label>
      <textarea id="exercise-instructions" rows={4} maxLength={2000} value={instructions}
        placeholder="Dodaj sposób wykonania ćwiczenia…" onChange={event => edit(e => { e.instructions = event.target.value; })} />
      <span className="instruction-count">{instructions.length}/2000</span>
      <div className="photo-section">
        {photoUrl ? <img className="photo-preview" src={photoUrl} alt={`Podgląd zdjęcia ćwiczenia ${exercise.name}`} />
          : <div className="photo-preview photo-placeholder">Brak zdjęcia</div>}
        <div className="photo-actions">
          <label className={`text-button photo-picker ${photoBusy ? 'disabled' : ''}`}>
            <ImagePlus size={17} /> {photo ? 'Zmień zdjęcie' : 'Dodaj zdjęcie'}
            <input ref={photoInput} type="file" accept="image/*" disabled={photoBusy} onChange={async event => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              setPhotoBusy(true);
              try { journal.setPhoto(exercise.exercise_id, await preparePhoto(file)); }
              finally { setPhotoBusy(false); }
            }} />
          </label>
          {photo && <button type="button" className="text-button" onClick={() => journal.removePhoto(exercise.exercise_id)}><Trash2 size={17} /> Usuń zdjęcie</button>}
        </div>
        <span className="photo-hint">Zdjęcie zostanie zapisane na tym telefonie.</span>
      </div>
    </div>}
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
  const localDates = Object.values(state.drafts)
    .filter(draft => draft.gitPending || draft.exercises.some(exercise => {
      const definition = state.plan?.exercises.find(item => item.exercise_id === exercise.exercise_id);
      const defaultRest = definition?.rest_seconds == null ? '' : String(definition.rest_seconds);
      return exercise.instructions.trim() !== '' || exercise.rest_seconds !== defaultRest ||
        exercise.sets.some(set => set.value !== '' || set.reps !== '');
    }))
    .map(draft => draft.date);
  const dates = [...new Set([...Object.keys(state.documents), ...localDates])].sort().reverse();
  const remove = (day: string) => {
    const draft = state.drafts[day];
    const hasUnsynced = !!draft?.dirty || !!draft?.gitPending;
    const location = state.documents[day] ? 'z serwera i telefonu' : 'z telefonu';
    const warning = hasUnsynced
      ? `Ten trening ma niezsynchronizowane zmiany, które zostaną bezpowrotnie usunięte ${location}. Kontynuować?`
      : `Czy na pewno usunąć ten trening ${location}?`;
    if (window.confirm(warning)) void journal.delete(day);
  };
  return <section aria-label="Zapisane treningi">
    {!dates.length && <p className="empty">Tutaj pojawią się Twoje treningi i lokalne wersje robocze.</p>}
    <div className="history-list">{dates.map(day => {
      const draft = state.drafts[day];
      return <div className="history-card" key={day}>
        <button className="history-main" onClick={() => navigate(`workout/${planId}/${day}`)}>
          <span><strong>{formatDay(day)}</strong><small>{draft?.dirty ? 'Zmiany tylko na telefonie' : draft?.gitPending ? 'Na serwerze · ponów historię zmian' : 'Zapisany na serwerze'}</small></span>
          <ChevronRight size={18} />
        </button>
        <button type="button" className="icon-button history-delete" aria-label={`Usuń trening ${formatDay(day)}`} title="Usuń trening"
          disabled={state.syncing.includes(day)} onClick={event => { event.stopPropagation(); remove(day); }}><Trash2 size={18} /></button>
      </div>;
    })}</div>
    <button className="text-button export" onClick={onExport}><Download size={17} /> Pobierz kopię danych z telefonu</button>
    <p className="muted footnote">Historia obejmuje zapisane treningi i wersje robocze dostępne na tym urządzeniu.</p>
  </section>;
}

function ProgressPlansView() {
  return <section className="plans-view" aria-label="Wybór planu do postępów">
    <div className="plans-intro">
      <p className="eyebrow">Postępy</p>
      <h2>Wybierz plan</h2>
      <p className="muted">Wybierz plan, aby zobaczyć wykresy tylko dla jego ćwiczeń.</p>
    </div>
    <div className="plans-dashboard">
      <div className="plan-list">
        {trainingPlans.map(plan => {
          const available = plan.status === 'ready';
          return <button key={plan.id} className={`plan-card ${plan.status}`} disabled={!available} onClick={available ? () => navigate(`progress/${plan.id}`) : undefined}
            aria-label={`${plan.title}: ${available ? 'pokaż postępy' : 'w przygotowaniu'}`}>
            <span className="plan-label">PLAN {plan.id}</span>
            <strong>{plan.title}</strong>
            <span className="plan-description">{plan.description}</span>
            <span className="plan-action">{available ? 'Pokaż wykresy' : 'W przygotowaniu'} {available && <ChevronRight size={17} />}</span>
          </button>;
        })}
      </div>
    </div>
    <p className="muted plans-footnote">Wykresy pokazują największą wartość z serii w wybranym okresie.</p>
  </section>;
}

function ProgressView({ journal, planId }: { journal: Journal; planId: string }) {
  const state = useSyncExternalStore(journal.subscribe, journal.snapshot);
  const [days, setDays] = useState<30 | 90>(30);
  const [end, setEnd] = useState(today());
  const start = shiftDay(end, -(days - 1));
  const [remote, setRemote] = useState<{ key: string; series: Series[] } | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const key = `${start}:${end}`;
  const meta = trainingPlans.find(candidate => candidate.id === planId);
  useEffect(() => {
    let active = true;
    setPlan(null);
    api.plan(planId).then(value => { if (active) setPlan(value); }).catch(() => {});
    return () => { active = false; };
  }, [planId]);
  useEffect(() => {
    let active = true;
    setRemote(null); setLoading(true);
    api.progress(start, end).then(series => { if (active) setRemote({ key, series }); }).catch(() => {}).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [key, start, end, state.documents]);
  const series = remote?.key === key ? remote.series : progress(Object.values(state.documents), start, end);
  const chartSeries = plan?.exercises.map(exercise => series.find(s => s.exercise_id === exercise.exercise_id && s.unit === exercise.unit) ?? { ...exercise, points: [] }) ?? [];
  return <section aria-label={`Wykresy postępów: ${meta?.title ?? `Plan ${planId}`}`}>
    <div className="progress-plan">
      <div className="progress-plan-heading"><p className="eyebrow">Plan {planId}</p><h2>{meta?.title ?? `Plan ${planId}`}</h2></div>
      <div className="segmented" aria-label="Zakres wykresów">{([30, 90] as const).map(n => <button key={n} aria-pressed={days === n} onClick={() => setDays(n)}>Ostatnie {n} dni</button>)}</div>
      <div className="date-row period"><label htmlFor="period-end">Do dnia</label><input id="period-end" type="date" value={end} max={today()} onChange={e => { if (isDay(e.target.value)) setEnd(e.target.value); }} /></div>
      <p className="muted footnote">{formatDay(start, true)} – {formatDay(end, true)} · największa wartość z serii. {loading ? 'Odświeżanie…' : remote ? 'Dane z serwera.' : 'Zapisane dane z telefonu.'} Niezsynchronizowane zmiany nie są uwzględniane.</p>
      {plan ? <div className="charts">{chartSeries.map(s => <Plot key={`${planId}:${s.exercise_id}:${s.unit}`} series={s} start={start} end={end} />)}</div>
        : <p className="muted">Połącz się z serwerem, aby pobrać ćwiczenia tego planu.</p>}
    </div>
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
      <button className="text-button" onClick={journal.cancelConflict}>Anuluj</button></div>
  </dialog>;
}
