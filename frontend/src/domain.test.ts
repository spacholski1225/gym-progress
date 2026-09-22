import { describe, expect, it } from 'vitest';
import { newDraft, parseInput, progress, shiftDay, toRequest } from './domain';
import type { Plan } from './types';
import { document, plan } from './test-fixtures';

describe('workout data', () => {
  it('accepts comma, dot, zero and empty fields without losing incomplete local text', () => {
    expect(parseInput('23,5', 'value')).toBe(23.5);
    expect(parseInput('23.5', 'value')).toBe(23.5);
    expect(parseInput('0', 'value')).toBe(0);
    expect(parseInput('', 'value')).toBe(null);
    expect(parseInput(',5', 'value')).toBe(0.5);
    expect(() => parseInput('1,5', 'reps')).toThrow();
    for (const value of ['Infinity', '1e2', '-1', '.', 'abc']) expect(() => parseInput(value, 'value')).toThrow();
  });
  it('copies only the preceding saved workout, preserving order, nulls and series count', () => {
    const draft = newDraft('2026-09-22', plan, [document(), document('2026-09-23')]);
    expect(draft.copiedFrom).toBe('2026-09-21');
    expect(draft.exercises.map(e => e.exercise_id)).toEqual(['bench_press', 'plank']);
    expect(draft.exercises[0].sets).toEqual([{ value: '23,5', reps: '8' }, { value: '0', reps: '' }]);
    expect(draft.exercises[1].sets).toEqual([{ value: '60', reps: '1' }]);
    expect(toRequest(draft).exercises[0].sets[1]).toEqual({ value: 0, reps: null });
    expect(draft.dirty).toBe(true);
  });
  it('uses empty defaults for a first workout or a mismatched unit', () => {
    expect(newDraft('2026-01-01', plan, []).exercises[0].sets).toHaveLength(3);
    const changed: Plan = { ...plan, exercises: [{ ...plan.exercises[0], unit: 'sec' }] };
    expect(newDraft('2026-09-22', changed, [document()]).exercises[0].sets[0].value).toBe('');
  });
  it.each([30, 90])('calculates inclusive %i-day ranges across timezone changes', days => {
    const end = '2026-11-01';
    const start = shiftDay(end, -(days - 1));
    const before = document(shiftDay(start, -1));
    const first = document(start);
    const last = document(end);
    last.exercises[0].unit = 'sec';
    const result = progress([last, before, first], start, end);
    expect(result.find(s => s.exercise_id === 'bench_press' && s.unit === 'kg')?.points).toEqual([{ date: start, value: 23.5 }]);
    expect(result.find(s => s.exercise_id === 'bench_press' && s.unit === 'sec')?.points).toEqual([{ date: end, value: 23.5 }]);
    expect(result.find(s => s.exercise_id === 'plank')?.points.map(p => p.date)).toEqual([start, end]);
  });
});
