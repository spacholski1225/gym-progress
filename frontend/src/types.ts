export type Unit = 'kg' | 'sec';
export type SetValue = { value: number | null; reps: number | null };
export type ExerciseDefinition = { exercise_id: string; name: string; unit: Unit; rest_seconds: number | null; instructions: string | null };
export type Exercise = ExerciseDefinition & { sets: SetValue[] };
export type Plan = { plan_id?: string; schema_version: 1; default_sets: number; exercises: ExerciseDefinition[] };
export type Content = { schema_version: 1; date: string; exercises: Exercise[] };
export type Workout = Content & { revision: string; created_at: string; updated_at: string };
export type WorkoutWrite = Content & { expected_revision: string | null };
export type SyncResult = { saved: true; changed: boolean; workout: Workout; git: {
  status: 'committed' | 'unchanged' | 'failed'; commit: string | null; error: string | null;
} };
export type DeleteResult = { deleted: true; date: string; git: { status: 'committed' | 'unchanged' | 'failed'; commit: string | null; error: string | null } };
export type InputSet = { value: string; reps: string };
export type InputExercise = Omit<ExerciseDefinition, 'rest_seconds' | 'instructions'> & { rest_seconds: string; instructions: string; sets: InputSet[] };
export type Draft = {
  date: string; exercises: InputExercise[]; baseRevision: string | null;
  generation: number; dirty: boolean; gitPending: boolean; copiedFrom: string | null;
};
export type Point = { date: string; value: number };
export type Series = Omit<ExerciseDefinition, 'rest_seconds' | 'instructions'> & { points: Point[] };
