import { useEffect, useRef, useState } from 'react';
import { formatDay, numberText, shiftDay } from './domain';
import type { Point, Series } from './types';

export function Plot({ series, start, end }: { series: Series; start: string; end: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [selected, setSelected] = useState<Point | null>(null);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setSelected(null), [series, start, end]);
  const height = 190, left = 48, right = width - 14, top = 25, bottom = 152;
  const startTime = Date.parse(start), endTime = Date.parse(end);
  const ceiling = Math.max(1, ...series.points.map(p => p.value)) * 1.12;
  const x = (date: string) => left + (Date.parse(date) - startTime) / Math.max(1, endTime - startTime) * (right - left);
  const y = (value: number) => bottom - value / ceiling * (bottom - top);
  const ticks = [start, shiftDay(start, Math.round((endTime - startTime) / 86400000 / 2)), end];
  const point = selected ?? series.points.at(-1);
  return <article className="chart-card"><div className="chart-heading"><h2>{series.name}</h2><span className="unit-tag">{series.unit}</span></div>
    <div ref={container}>
      {!series.points.length ? <p className="chart-empty">Brak wpisanych wartości w tym okresie.</p> : <>
        <svg className="plot" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${series.name}: maksymalna wartość w ${series.unit} według daty treningu. Wybierz punkt, aby odczytać wynik.`}>
          <text x={left} y={13} className="axis-label">{series.unit === 'kg' ? 'Ciężar (kg)' : 'Czas (sec)'}</text>
          {[0, ceiling / 2, ceiling].map(value => <g key={value}><line x1={left} y1={y(value)} x2={right} y2={y(value)} className="grid-line" /><text x={left - 9} y={y(value) + 4} textAnchor="end">{numberText(Math.round(value * 10) / 10)}</text></g>)}
          {ticks.map((day, i) => <text key={day} x={x(day)} y={bottom + 21} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>{new Date(`${day}T12:00:00Z`).toLocaleDateString('pl-PL', { day: 'numeric', month: 'numeric', timeZone: 'UTC' })}</text>)}
          <polyline points={series.points.map(p => `${x(p.date)},${y(p.value)}`).join(' ')} className="plot-line" />
          {series.points.map(p => <circle key={p.date} cx={x(p.date)} cy={y(p.value)} r={point?.date === p.date ? 5 : 3} className="plot-dot" />)}
          <rect x={left} y={top - 5} width={Math.max(1, right - left)} height={bottom - top + 10} fill="transparent" onPointerDown={event => {
            const bounds = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
            const at = (event.clientX - bounds.left) / bounds.width * width;
            const closest = series.points.reduce((best, p) => Math.abs(x(p.date) - at) < Math.abs(x(best.date) - at) ? p : best);
            setSelected(closest);
          }} />
        </svg>
        <div className="point-reading" aria-live="polite"><span>{point ? formatDay(point.date, true) : 'Data treningu'}</span><strong>{point ? `${numberText(point.value)} ${series.unit}` : '—'}</strong></div>
        <details className="chart-data"><summary>Wartości treningów</summary><ul>{series.points.map(p => <li key={p.date}><button onClick={() => setSelected(p)}>{formatDay(p.date, true)}<strong>{numberText(p.value)} {series.unit}</strong></button></li>)}</ul></details>
      </>}
    </div>
  </article>;
}
