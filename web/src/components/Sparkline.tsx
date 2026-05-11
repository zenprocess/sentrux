/**
 * 30-day score sparkline.
 *
 * Phase 2 MVP placeholder — the daemon does not yet expose a per-repo history
 * endpoint (probing `/history` returned 404 at the time of writing). When that
 * endpoint lands (tracked for Phase 2.1), wire `data` to its response and drop
 * the placeholder branch. The component already renders a real polyline from
 * whatever `data` is passed, so the integration is a one-line client call.
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
        no history yet — queued for Phase 2.1
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
