// A dependency-free trend chart. It renders an inline SVG polyline with a point
// per run and red markers on the runs that regressed. No chart library, no
// client JavaScript: the whole thing is a server-rendered SVG, which keeps the
// demo light and works anywhere static output does.

interface LineChartProps {
  label: string;
  values: number[];
  // Indices into values that should be marked as regressions.
  regressedIndices?: number[];
  // Formats the latest value shown beside the label.
  format?: (v: number) => string;
  // Optional fixed domain; defaults to the data's own min and max.
  min?: number;
  max?: number;
  color?: string;
}

const W = 260;
const H = 72;
const PAD = 8;

export function LineChart({
  label,
  values,
  regressedIndices = [],
  format = (v) => v.toFixed(2),
  min,
  max,
  color = "#58a6ff",
}: LineChartProps) {
  // With no data, Math.min/max over an empty array yields +/-Infinity and the
  // SVG math produces NaN coordinates. Render a neutral empty state instead.
  if (values.length === 0) {
    return (
      <div className="panel">
        <div className="chart-title">
          <span className="label">{label}</span>
          <span className="latest">-</span>
        </div>
        <div className="meta" style={{ height: H, display: "flex", alignItems: "center" }}>
          no data yet
        </div>
      </div>
    );
  }

  const lo = min ?? Math.min(...values);
  const hi = max ?? Math.max(...values);
  const span = hi - lo || 1;
  const n = values.length;

  const x = (i: number) => (n <= 1 ? PAD : PAD + (i * (W - 2 * PAD)) / (n - 1));
  const y = (v: number) => H - PAD - ((v - lo) / span) * (H - 2 * PAD);

  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const regressed = new Set(regressedIndices);
  const latest = values.length ? format(values[values.length - 1]!) : "-";

  return (
    <div className="panel">
      <div className="chart-title">
        <span className="label">{label}</span>
        <span className="latest">{latest}</span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} trend`}>
        <polyline points={points} fill="none" stroke={color} strokeWidth="2" />
        {values.map((v, i) => {
          const bad = regressed.has(i);
          return (
            <circle
              key={i}
              cx={x(i)}
              cy={y(v)}
              r={bad ? 4 : 2.5}
              fill={bad ? "#f85149" : color}
              stroke={bad ? "#f85149" : "none"}
            />
          );
        })}
      </svg>
    </div>
  );
}
