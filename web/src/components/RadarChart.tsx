import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { LinePath, Line, Polygon } from "@visx/shape";
import { Text } from "@visx/text";
import {
  INDICATOR_LABELS,
  INDICATOR_ORDER,
  type IndicatorKey,
  type IndicatorReading,
} from "../api/types";

export interface RadarChartProps {
  indicators: Record<IndicatorKey, IndicatorReading>;
  size?: number;
  levels?: number;
  /** Optional second series (e.g. baseline) drawn underneath. */
  baseline?: Record<IndicatorKey, IndicatorReading> | null;
}

interface RadialPoint {
  x: number;
  y: number;
}

function polar(angle: number, radius: number): RadialPoint {
  return {
    x: radius * Math.cos(angle - Math.PI / 2),
    y: radius * Math.sin(angle - Math.PI / 2),
  };
}

/**
 * A small radar/spider chart for the 5 sentrux indicators (each on [0, 1]).
 *
 * Pure SVG via @visx primitives. No external chart deps.
 */
export function RadarChart({
  indicators,
  size = 360,
  levels = 4,
  baseline = null,
}: RadarChartProps): JSX.Element {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 56;
  const axes = INDICATOR_ORDER;
  const angleFor = (i: number): number => (i * 2 * Math.PI) / axes.length;

  const r = scaleLinear<number>({ domain: [0, 1], range: [0, radius] });

  const seriesPoints = (
    series: Record<IndicatorKey, IndicatorReading>,
  ): RadialPoint[] =>
    axes.map((k, i) => polar(angleFor(i), r(Math.max(0, Math.min(1, series[k].value)))));

  const points = seriesPoints(indicators);
  const baselinePoints = baseline ? seriesPoints(baseline) : null;

  // Convex polygon for the value polygon outline.
  const polygonPoints: [number, number][] = points.map((p) => [p.x, p.y]);
  const baselinePolygonPoints: [number, number][] | null = baselinePoints
    ? baselinePoints.map((p) => [p.x, p.y])
    : null;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Sentrux indicators radar"
      data-testid="radar-chart"
    >
      <Group left={cx} top={cy}>
        {/* concentric web */}
        {Array.from({ length: levels }, (_, level) => {
          const lvl = (level + 1) / levels;
          const webPts: [number, number][] = axes.map((_k, i) => {
            const p = polar(angleFor(i), r(lvl));
            return [p.x, p.y];
          });
          return (
            <Polygon
              key={`web-${level}`}
              points={webPts}
              stroke="rgba(255,255,255,0.08)"
              fill="none"
            />
          );
        })}

        {/* axes */}
        {axes.map((k, i) => {
          const end = polar(angleFor(i), r(1));
          return (
            <Line
              key={`axis-${k}`}
              from={{ x: 0, y: 0 }}
              to={{ x: end.x, y: end.y }}
              stroke="rgba(255,255,255,0.1)"
            />
          );
        })}

        {/* baseline polygon (dashed, muted) */}
        {baselinePolygonPoints && (
          <Polygon
            points={baselinePolygonPoints}
            stroke="rgba(150, 200, 255, 0.55)"
            strokeDasharray="4 3"
            fill="rgba(150, 200, 255, 0.08)"
            data-testid="radar-baseline"
          />
        )}

        {/* main value polygon */}
        <Polygon
          points={polygonPoints}
          fill="rgba(103, 212, 160, 0.18)"
          stroke="rgb(103, 212, 160)"
          strokeWidth={2}
          data-testid="radar-current"
        />

        {/* points */}
        {points.map((p, i) => (
          <circle
            key={`pt-${axes[i]}`}
            cx={p.x}
            cy={p.y}
            r={3.5}
            fill="rgb(103, 212, 160)"
          />
        ))}

        {/* axis labels */}
        {axes.map((k, i) => {
          const labelPos = polar(angleFor(i), radius + 22);
          return (
            <Text
              key={`label-${k}`}
              x={labelPos.x}
              y={labelPos.y}
              fontSize={12}
              fill="rgba(220, 230, 240, 0.9)"
              textAnchor="middle"
              verticalAnchor="middle"
            >
              {INDICATOR_LABELS[k]}
            </Text>
          );
        })}
      </Group>
      {/* keep linepath import alive for tree-shaking discipline; unused intentionally for now */}
      <LinePath data={[]} x={() => 0} y={() => 0} stroke="none" />
    </svg>
  );
}
