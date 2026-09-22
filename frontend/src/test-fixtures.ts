import type { Plan, Workout } from './types';
export const plan: Plan = { schema_version: 1, default_sets: 3, exercises: [
  { exercise_id: 'bench_press', name: 'Wyciskanie leżąc', unit: 'kg' },
  { exercise_id: 'plank', name: 'Plank', unit: 'sec' },
] };
export function document(day = '2026-09-21', revision = 'a'.repeat(32)): Workout {
  return { schema_version: 1, date: day, revision, created_at: `${day}T12:00:00Z`, updated_at: `${day}T12:00:00Z`, exercises: [
    { ...plan.exercises[0], sets: [{ value: 23.5, reps: 8 }, { value: 0, reps: null }] },
    { ...plan.exercises[1], sets: [{ value: 60, reps: 1 }] },
  ] };
}
