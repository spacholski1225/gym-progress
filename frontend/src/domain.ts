import type { Draft, InputSet, Plan, Series, Workout, WorkoutWrite } from './types';

export function today(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}
export function formatDay(day: string, short = false): string {
  return new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric', month: short ? 'short' : 'long', ...(short ? {} : { year: 'numeric' }), timeZone: 'UTC',
  }).format(new Date(`${day}T12:00:00Z`));
}
export function isDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day)) &&
    new Date(day).toISOString().slice(0, 10) === day;
}
export const numberText = (number: number | null): string => number === null ? '' : String(number).replace('.', ',');
export function parseInput(text: string, field: keyof InputSet): number | null {
  const value = text.trim();
  if (value === '') return null;
  const pattern = field === 'reps' ? /^\d+$/ : /^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/;
  const number = Number(value.replace(',', '.'));
  if (!pattern.test(value) || !Number.isFinite(number) || number < 0 ||
      (field === 'reps' && !Number.isSafeInteger(number))) {
    throw new Error(field === 'reps' ? 'Powtórzenia muszą być liczbą całkowitą.' : 'Wpisz nieujemną liczbę, np. 23,5.');
  }
  return number;
}
export function fromWorkout(workout: Workout, generation = 0): Draft {
  return {
    date: workout.date, baseRevision: workout.revision, generation, dirty: false,
    gitPending: false, copiedFrom: null,
    exercises: workout.exercises.map(exercise => ({ ...exercise,
      sets: exercise.sets.map(set => ({ value: numberText(set.value), reps: numberText(set.reps) })),
    })),
  };
}
export function newDraft(day: string, plan: Plan, documents: Workout[]): Draft {
  const previous = documents.filter(w => w.date < day &&
    w.exercises.length === plan.exercises.length &&
    w.exercises.every((exercise, i) => {
      const definition = plan.exercises[i];
      return exercise.exercise_id === definition.exercise_id && exercise.unit === definition.unit;
    })).sort((a, b) => b.date.localeCompare(a.date))[0];
  return {
    date: day, baseRevision: null, generation: 0, dirty: true, gitPending: false,
    copiedFrom: previous?.date ?? null,
    exercises: plan.exercises.map(exercise => {
      const before = previous?.exercises.find(e => e.exercise_id === exercise.exercise_id && e.unit === exercise.unit);
      return { ...exercise, sets: before
        ? before.sets.map(set => ({ value: numberText(set.value), reps: numberText(set.reps) }))
        : Array.from({ length: plan.default_sets }, () => ({ value: '', reps: '' })) };
    }),
  };
}
export function toRequest(draft: Draft): WorkoutWrite {
  return { schema_version: 1, date: draft.date, expected_revision: draft.baseRevision,
    exercises: draft.exercises.map(exercise => ({ ...exercise, sets: exercise.sets.map((set, i) => {
      try { return { value: parseInput(set.value, 'value'), reps: parseInput(set.reps, 'reps') }; }
      catch (error) { throw new Error(`${exercise.name}, seria ${i + 1}: ${(error as Error).message}`); }
    }) })),
  };
}
export function progress(documents: Workout[], start: string, end: string): Series[] {
  const groups = new Map<string, Series>();
  for (const workout of documents.filter(w => w.date >= start && w.date <= end).sort((a, b) => a.date.localeCompare(b.date))) {
    for (const exercise of workout.exercises) {
      const values = exercise.sets.map(s => s.value).filter((v): v is number => v !== null);
      if (!values.length) continue;
      const key = `${exercise.exercise_id}:${exercise.unit}`;
      const series = groups.get(key) ?? { exercise_id: exercise.exercise_id, name: exercise.name, unit: exercise.unit, points: [] };
      series.name = exercise.name;
      series.points.push({ date: workout.date, value: Math.max(...values) });
      groups.set(key, series);
    }
  }
  return [...groups.values()];
}
