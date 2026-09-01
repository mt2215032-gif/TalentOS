'use client';

import { useId, useMemo, useState } from 'react';

/**
 * Score progression over time.
 *
 * A single series, so no legend — the title names it. Interaction is a
 * crosshair with a tooltip, which is the default for a line chart rather than
 * an enhancement. A table view is rendered for screen readers and for anyone
 * who needs the numbers rather than the shape.
 */

export interface LinePoint {
  label: string;
  value: number;
  /** Secondary line in the tooltip, e.g. the role. */
  sublabel?: string;
}

interface Props {
  points: LinePoint[];
  /** Fixed domain keeps successive interviews comparable. */
  min?: number;
  max?: number;
  height?: number;
  ariaLabel: string;
}

const PADDING = { top: 16, right: 16, bottom: 28, left: 34 };

export function LineChart({ points, min = 0, max = 100, height = 220, ariaLabel }: Props) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const gradientId = useId();

  // The chart draws in a fixed coordinate space and scales with the viewBox,
  // so it stays sharp at any width without measuring the DOM.
  const width = 640;
  const plotWidth = width - PADDING.left - PADDING.right;
  const plotHeight = height - PADDING.top - PADDING.bottom;

  const geometry = useMemo(() => {
    if (points.length === 0) return null;

    const x = (index: number): number =>
      points.length === 1
        ? PADDING.left + plotWidth / 2
        : PADDING.left + (index / (points.length - 1)) * plotWidth;

    const y = (value: number): number =>
      PADDING.top + plotHeight - ((value - min) / (max - min)) * plotHeight;

    const coordinates = points.map((point, index) => ({ x: x(index), y: y(point.value), point, index }));

    const line = coordinates
      .map((c, index) => `${index === 0 ? 'M' : 'L'}${c.x.toFixed(2)},${c.y.toFixed(2)}`)
      .join(' ');

    const area =
      coordinates.length > 1
        ? `${line} L${(coordinates[coordinates.length - 1]?.x ?? 0).toFixed(2)},${PADDING.top + plotHeight} L${(coordinates[0]?.x ?? 0).toFixed(2)},${PADDING.top + plotHeight} Z`
        : '';

    return { coordinates, line, area, y };
  }, [points, min, max, plotWidth, plotHeight]);

  if (!geometry || points.length === 0) {
    return (
      <p className="py-10 text-center text-[13px] text-[var(--text-subtle)]">
        No data yet.
      </p>
    );
  }

  const gridValues = [min, min + (max - min) / 2, max];
  const active = hoverIndex !== null ? geometry.coordinates[hoverIndex] : null;

  return (
    <figure className="m-0">
      <div className="relative w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full"
          style={{ minWidth: Math.max(280, points.length * 44) }}
          role="img"
          aria-label={ariaLabel}
          onMouseLeave={() => setHoverIndex(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--viz-accent)" stopOpacity="0.16" />
              <stop offset="100%" stopColor="var(--viz-accent)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Grid and axis stay recessive — they orient, they do not compete. */}
          {gridValues.map((value) => (
            <g key={value}>
              <line
                x1={PADDING.left}
                x2={width - PADDING.right}
                y1={geometry.y(value)}
                y2={geometry.y(value)}
                stroke="var(--viz-grid)"
                strokeWidth="1"
              />
              <text
                x={PADDING.left - 8}
                y={geometry.y(value) + 4}
                textAnchor="end"
                fontSize="10"
                fill="var(--viz-axis)"
              >
                {value}
              </text>
            </g>
          ))}

          {points.length > 1 ? <path d={geometry.area} fill={`url(#${gradientId})`} /> : null}

          <path
            d={geometry.line}
            fill="none"
            stroke="var(--viz-accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {geometry.coordinates.map((c) => (
            <circle
              key={c.index}
              cx={c.x}
              cy={c.y}
              r={hoverIndex === c.index ? 5.5 : 4}
              fill="var(--viz-accent)"
              // A 2px surface ring keeps overlapping points readable.
              stroke="var(--surface)"
              strokeWidth="2"
            />
          ))}

          {active ? (
            <line
              x1={active.x}
              x2={active.x}
              y1={PADDING.top}
              y2={PADDING.top + plotHeight}
              stroke="var(--viz-axis)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          ) : null}

          {/* X labels are thinned so they never collide. */}
          {geometry.coordinates.map((c) =>
            points.length <= 8 || c.index % Math.ceil(points.length / 6) === 0 ? (
              <text
                key={`label-${c.index}`}
                x={c.x}
                y={height - 8}
                textAnchor="middle"
                fontSize="10"
                fill="var(--viz-axis)"
              >
                {c.point.label}
              </text>
            ) : null,
          )}

          {/* Hit targets are wider than the marks. */}
          {geometry.coordinates.map((c) => (
            <rect
              key={`hit-${c.index}`}
              x={c.x - plotWidth / Math.max(points.length, 1) / 2}
              y={PADDING.top}
              width={Math.max(24, plotWidth / Math.max(points.length, 1))}
              height={plotHeight}
              fill="transparent"
              onMouseEnter={() => setHoverIndex(c.index)}
            />
          ))}
        </svg>

        {active ? (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-[12px] shadow-[var(--shadow-lg)]"
            style={{
              left: `${(active.x / width) * 100}%`,
              top: `${(active.y / height) * 100}%`,
              marginTop: -12,
            }}
          >
            <div className="font-semibold text-[var(--text)]">{active.point.value}/100</div>
            <div className="text-[var(--text-muted)]">{active.point.label}</div>
            {active.point.sublabel ? (
              <div className="text-[var(--text-subtle)]">{active.point.sublabel}</div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* The numbers, for anyone who needs them rather than the shape. */}
      <details className="mt-2">
        <summary className="cursor-pointer text-[12px] text-[var(--text-subtle)] hover:text-[var(--text-muted)]">
          View as table
        </summary>
        <table className="mt-2 w-full text-left text-[12px]">
          <thead>
            <tr className="text-[var(--text-subtle)]">
              <th className="py-1 font-medium">When</th>
              <th className="py-1 font-medium">Detail</th>
              <th className="py-1 text-right font-medium">Score</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point, index) => (
              <tr key={`${point.label}-${index}`} className="border-t border-[var(--border)]">
                <td className="py-1 text-[var(--text-muted)]">{point.label}</td>
                <td className="py-1 text-[var(--text-muted)]">{point.sublabel ?? '—'}</td>
                <td className="py-1 text-right font-medium text-[var(--text)]">{point.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
