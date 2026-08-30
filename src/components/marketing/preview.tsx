import { Card, ScorePill } from '@/components/ui/primitives';

/**
 * Dashboard preview for the landing page.
 *
 * The numbers are an illustration of the layout, and the caption says so —
 * a marketing screenshot that implies real aggregate results would be a lie
 * about a product that has no users yet.
 */

const SAMPLE_PROGRESSION = [62, 71, 68, 79, 84];
const SAMPLE_SKILLS = [
  { label: 'SQL', value: 84 },
  { label: 'Python', value: 78 },
  { label: 'System Design', value: 61 },
  { label: 'Communication', value: 72 },
  { label: 'Spark', value: 43 },
];

export function DashboardPreview() {
  const width = 560;
  const height = 180;
  const padding = 24;
  const max = 100;

  const points = SAMPLE_PROGRESSION.map((value, index) => {
    const x = padding + (index / (SAMPLE_PROGRESSION.length - 1)) * (width - padding * 2);
    const y = padding + (1 - value / max) * (height - padding * 2);
    return { x, y, value };
  });

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  return (
    <figure className="m-0">
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <div className="mb-4 flex items-baseline justify-between">
            <h3 className="text-[15px] font-semibold tracking-tight text-[var(--text)]">
              Score progression
            </h3>
            <ScorePill score={84} />
          </div>
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Illustrative score progression rising from 62 to 84 across five interviews">
            {[0, 50, 100].map((value) => {
              const y = padding + (1 - value / max) * (height - padding * 2);
              return (
                <g key={value}>
                  <line x1={padding} x2={width - padding} y1={y} y2={y} stroke="var(--viz-grid)" />
                  <text x={padding - 6} y={y + 3} textAnchor="end" fontSize="9" fill="var(--viz-axis)">
                    {value}
                  </text>
                </g>
              );
            })}
            <path
              d={`${line} L${points[points.length - 1]?.x ?? 0},${height - padding} L${points[0]?.x ?? 0},${height - padding} Z`}
              fill="var(--viz-accent)"
              fillOpacity="0.1"
            />
            <path
              d={line}
              fill="none"
              stroke="var(--viz-accent)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {points.map((p) => (
              <g key={p.x}>
                <circle cx={p.x} cy={p.y} r="4" fill="var(--viz-accent)" stroke="var(--surface)" strokeWidth="2" />
                <text x={p.x} y={p.y - 11} textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--text-muted)">
                  {p.value}
                </text>
              </g>
            ))}
            {points.map((p, index) => (
              <text key={`x-${p.x}`} x={p.x} y={height - 6} textAnchor="middle" fontSize="9" fill="var(--viz-axis)">
                {`#${index + 1}`}
              </text>
            ))}
          </svg>
        </Card>

        <Card className="lg:col-span-2">
          <h3 className="mb-4 text-[15px] font-semibold tracking-tight text-[var(--text)]">
            Skill breakdown
          </h3>
          <ul className="space-y-3">
            {SAMPLE_SKILLS.map((skill) => (
              <li key={skill.label}>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <span className="text-[13px] font-medium text-[var(--text)]">{skill.label}</span>
                  <span className="text-[12px] font-semibold tabular-nums text-[var(--text-muted)]">
                    {skill.value}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg-subtle)]">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${skill.value}%`, background: 'var(--viz-accent)' }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <figcaption className="mt-3 text-[12px] text-[var(--text-subtle)]">
        Illustrative figures showing the dashboard layout — not aggregate platform results.
      </figcaption>
    </figure>
  );
}
