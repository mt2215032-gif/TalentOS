'use client';

import { scoreBand } from '@/components/ui/primitives';

/**
 * Horizontal bars for scored items.
 *
 * Bar length already encodes magnitude, so colour is not repeating it —
 * `colorByBand` is off by default, and where it is on, the band label is
 * rendered beside the bar so the colour never carries the meaning alone.
 */

export interface BarItem {
  label: string;
  value: number;
  /** Right-hand annotation, e.g. "3 answers". */
  meta?: string;
  /** Renders the row muted, for skills that were never tested. */
  untested?: boolean;
}

export function BarList({
  items,
  max = 100,
  colorByBand = false,
  showBandLabel = false,
  emptyMessage = 'Nothing to show yet.',
}: {
  items: BarItem[];
  max?: number;
  colorByBand?: boolean;
  showBandLabel?: boolean;
  emptyMessage?: string;
}) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-[13px] text-[var(--text-subtle)]">{emptyMessage}</p>;
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => {
        const band = scoreBand(item.value);
        const pct = max === 0 ? 0 : Math.max(0, Math.min(100, (item.value / max) * 100));
        const color = item.untested
          ? 'var(--border-strong)'
          : colorByBand
            ? band.color
            : 'var(--viz-accent)';

        return (
          <li key={item.label}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span
                className={`truncate text-[13px] font-medium ${
                  item.untested ? 'text-[var(--text-subtle)]' : 'text-[var(--text)]'
                }`}
                title={item.label}
              >
                {item.label}
              </span>
              <span className="flex shrink-0 items-baseline gap-2 text-[12px]">
                {showBandLabel && !item.untested ? (
                  <span className="text-[var(--text-subtle)]">{band.label}</span>
                ) : null}
                {item.meta ? <span className="text-[var(--text-subtle)]">{item.meta}</span> : null}
                <span className="font-semibold tabular-nums text-[var(--text)]">
                  {item.untested ? '—' : item.value}
                </span>
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg-subtle)]">
              <div
                className="h-full rounded-full transition-[width] duration-700 ease-out"
                style={{ width: `${item.untested ? 100 : pct}%`, background: color, opacity: item.untested ? 0.25 : 1 }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A compact trend line, for a stat tile.
 *
 * No axes and no interaction — it shows direction, and the number beside it
 * carries the value.
 */
export function Sparkline({ values, height = 28 }: { values: number[]; height?: number }) {
  if (values.length < 2) return null;

  const width = 96;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const path = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / span) * (height - 4) - 2;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const rising = (values[values.length - 1] ?? 0) >= (values[0] ?? 0);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      <path
        d={path}
        fill="none"
        stroke={rising ? 'var(--viz-good)' : 'var(--viz-bad)'}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Grouped vertical bars for the admin daily view.
 *
 * Two series, so a legend is present and the pair uses validated categorical
 * slots. A 2px gap separates adjacent bars.
 */
export function GroupedBars({
  data,
  seriesLabels,
  height = 160,
  ariaLabel,
}: {
  data: Array<{ label: string; values: [number, number] }>;
  seriesLabels: [string, string];
  height?: number;
  ariaLabel: string;
}) {
  if (data.length === 0) {
    return <p className="py-6 text-center text-[13px] text-[var(--text-subtle)]">No activity yet.</p>;
  }

  const width = 640;
  const padding = { top: 8, right: 8, bottom: 22, left: 26 };
  const plotHeight = height - padding.top - padding.bottom;
  const plotWidth = width - padding.left - padding.right;
  const max = Math.max(1, ...data.flatMap((d) => d.values));
  const groupWidth = plotWidth / data.length;
  const barWidth = Math.max(2, (groupWidth - 6) / 2);
  const colors = ['var(--viz-accent)', 'var(--viz-series-2)'] as const;

  return (
    <figure className="m-0">
      <div className="mb-2 flex items-center gap-4">
        {seriesLabels.map((label, index) => (
          <span key={label} className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: colors[index] }} />
            {label}
          </span>
        ))}
      </div>
      <div className="w-full overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ minWidth: 320 }} role="img" aria-label={ariaLabel}>
          <line
            x1={padding.left}
            x2={width - padding.right}
            y1={padding.top + plotHeight}
            y2={padding.top + plotHeight}
            stroke="var(--viz-grid)"
          />
          <text x={padding.left - 6} y={padding.top + 8} textAnchor="end" fontSize="9" fill="var(--viz-axis)">
            {max}
          </text>

          {data.map((group, index) =>
            group.values.map((value, series) => {
              const barHeight = (value / max) * plotHeight;
              // 2px between the pair keeps the surface visible between fills.
              const x = padding.left + index * groupWidth + 2 + series * (barWidth + 2);
              return (
                <rect
                  key={`${group.label}-${series}`}
                  x={x}
                  y={padding.top + plotHeight - barHeight}
                  width={barWidth}
                  height={Math.max(0, barHeight)}
                  rx="2"
                  fill={colors[series]}
                >
                  <title>{`${group.label} · ${seriesLabels[series]}: ${value}`}</title>
                </rect>
              );
            }),
          )}

          {data.map((group, index) =>
            index % Math.ceil(data.length / 8) === 0 ? (
              <text
                key={`x-${group.label}`}
                x={padding.left + index * groupWidth + groupWidth / 2}
                y={height - 6}
                textAnchor="middle"
                fontSize="9"
                fill="var(--viz-axis)"
              >
                {group.label.slice(5)}
              </text>
            ) : null,
          )}
        </svg>
      </div>
    </figure>
  );
}
