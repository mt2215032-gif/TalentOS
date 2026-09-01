'use client';

import { useState } from 'react';

/**
 * Skill profile radar.
 *
 * One series — the candidate's current level per skill — so identity needs no
 * colour coding. Axis labels are always drawn, which is what makes the shape
 * readable rather than decorative.
 */

export interface RadarAxis {
  label: string;
  value: number;
}

export function RadarChart({
  axes,
  size = 300,
  ariaLabel,
}: {
  axes: RadarAxis[];
  size?: number;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  // Below three axes a radar is meaningless — the caller should use bars.
  if (axes.length < 3) {
    return (
      <p className="py-10 text-center text-[13px] text-[var(--text-subtle)]">
        A skill profile needs at least three assessed skills. Complete another interview to fill it in.
      </p>
    );
  }

  const visible = axes.slice(0, 8);
  const center = size / 2;
  const radius = center - 46;
  const rings = [25, 50, 75, 100];
  // Labels sit outside the outer ring, so the drawing area alone is not enough
  // room for them. The viewBox is widened symmetrically rather than shrinking
  // the polygon, which would waste the space the chart is given.
  const gutter = 52;

  const pointFor = (index: number, value: number): { x: number; y: number } => {
    // Start at twelve o'clock so the first skill reads as the top of the shape.
    const angle = (Math.PI * 2 * index) / visible.length - Math.PI / 2;
    const distance = (value / 100) * radius;
    return { x: center + Math.cos(angle) * distance, y: center + Math.sin(angle) * distance };
  };

  const polygon = visible
    .map((axis, index) => {
      const p = pointFor(index, axis.value);
      return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <figure className="m-0">
      <svg
        viewBox={`${-gutter} -6 ${size + gutter * 2} ${size + 12}`}
        className="mx-auto w-full max-w-[420px]"
        role="img"
        aria-label={ariaLabel}
      >
        {rings.map((ring) => (
          <polygon
            key={ring}
            points={visible
              .map((_, index) => {
                const p = pointFor(index, ring);
                return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
              })
              .join(' ')}
            fill="none"
            stroke="var(--viz-grid)"
            strokeWidth="1"
          />
        ))}

        {visible.map((axis, index) => {
          const outer = pointFor(index, 100);
          return (
            <line
              key={`spoke-${axis.label}`}
              x1={center}
              y1={center}
              x2={outer.x}
              y2={outer.y}
              stroke="var(--viz-grid)"
              strokeWidth="1"
            />
          );
        })}

        <polygon
          points={polygon}
          fill="var(--viz-accent)"
          fillOpacity="0.18"
          stroke="var(--viz-accent)"
          strokeWidth="2"
          strokeLinejoin="round"
        />

        {visible.map((axis, index) => {
          const p = pointFor(index, axis.value);
          return (
            <circle
              key={`point-${axis.label}`}
              cx={p.x}
              cy={p.y}
              r={hover === index ? 6 : 4}
              fill="var(--viz-accent)"
              stroke="var(--surface)"
              strokeWidth="2"
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}

        {visible.map((axis, index) => {
          const label = pointFor(index, 118);
          const anchor = label.x < center - 6 ? 'end' : label.x > center + 6 ? 'start' : 'middle';
          return (
            <text
              key={`label-${axis.label}`}
              x={label.x}
              y={label.y + 3}
              textAnchor={anchor}
              fontSize="10"
              fill={hover === index ? 'var(--text)' : 'var(--viz-axis)'}
              fontWeight={hover === index ? 600 : 400}
            >
              {axis.label.length > 16 ? `${axis.label.slice(0, 15)}…` : axis.label}
              <tspan fill="var(--text-subtle)"> {axis.value}</tspan>
            </text>
          );
        })}
      </svg>
    </figure>
  );
}
