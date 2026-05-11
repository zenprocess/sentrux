/**
 * 30-day score sparkline.
 *
 * Placeholder pending a daemon-side history endpoint. `sentrux serve` does not
 * expose `GET /history?repo=...` yet (Phase 2.1 probe confirmed 404 — the
 * baseline store keeps only the current baseline, not a per-day series), so
 * there is nothing to fetch. Tracked upstream: the daemon needs to persist and
 * serve daily composite scores. The component already renders a real polyline
 * from whatever `number[]` is passed, so wiring it is a one-line client call
 * once the endpoint exists.
 */
interface SparklineProps {
  data: number[] | null;
  width?: number;
  height?: number;
}

export function Sparkline({
  data,
  width = 320,
  height = 56,
}: SparklineProps): JSX.Element {
  if (!data || data.length < 2) {
    return (
      <div
        className="sparkline-empty"
        style={{ width, height }}
        data-testid="sparkline-empty"
      >
        no history — daemon has no /history endpoint yet
      </div>
    );
  }

  const min = Math.min(...data, 0);
  const max = Math.max(...data, 100);
  const range = Math.max(max - min, 1);
  const step = width / Math.max(data.length - 1, 1);

  const points = data
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="30-day score sparkline"
      data-testid="sparkline"
    >
      <polyline
        points={points}
        fill="none"
        stroke="rgba(103, 212, 160, 0.85)"
        strokeWidth={1.6}
      />
    </svg>
  );
}
