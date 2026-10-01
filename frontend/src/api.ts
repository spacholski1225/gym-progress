import type { Plan, Series, SyncResult, Workout, WorkoutWrite } from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.method === 'PUT' ? 45000 : 10000);
  try {
    const response = await fetch(`/api${path}`, { ...options, cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...options.headers } });
    if (!response.ok) {
      throw new ApiError(response.status, response.status === 409 ? 'Na serwerze jest inna wersja treningu.'
        : response.status === 422 ? 'Serwer odrzucił dane. Sprawdź wpisane wartości.' : `Błąd serwera (${response.status}).`);
    }
    return await response.json() as T;
  } finally { clearTimeout(timeout); }
}
export const api = {
  plan: (planId = 'A') => request<Plan>(`/plan?id=${encodeURIComponent(planId)}`),
  list: () => request<Workout[]>('/workouts?from=0001-01-01&to=9999-12-31'),
  get: (day: string) => request<Workout>(`/workouts/${day}`),
  save: (data: WorkoutWrite) => request<SyncResult>(`/workouts/${data.date}`, { method: 'PUT', body: JSON.stringify(data) }),
  progress: (start: string, end: string) => request<Series[]>(`/progress?from=${start}&to=${end}`),
};
