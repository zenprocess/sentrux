import { useMemo, useState } from "react";
import type { TreemapData, TreemapFile } from "../api/types";

export interface TreemapProps {
  data: TreemapData;
  width?: number;
  height?: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PlacedTile extends Rect {
  file: TreemapFile;
}

/**
 * Squarified treemap layout (Bruls/Huizing/van Wijk). Tiles are sized by the
 * daemon-reported magnitude (`file.size` — fan-out for "god" files, churn for
 * "hotspot" files) and coloured by kind. Pure SVG, no external layout deps,
 * so the GUI bundle barely moves.
 */
function squarify(items: TreemapFile[], rect: Rect): PlacedTile[] {
  const total = items.reduce((s, it) => s + Math.max(it.size, 0.0001), 0);
  if (total <= 0 || items.length === 0) return [];

  // Scale magnitudes into area units (px²).
  const area = rect.w * rect.h;
  const scaled = items.map((it) => ({
    file: it,
    a: (Math.max(it.size, 0.0001) / total) * area,
  }));

  const placed: PlacedTile[] = [];
  let free: Rect = { ...rect };
  let row: { file: TreemapFile; a: number }[] = [];

  const shortestSide = (): number => Math.min(free.w, free.h);

  const worst = (
    candidate: { file: TreemapFile; a: number }[],
    side: number,
  ): number => {
    if (candidate.length === 0) return Infinity;
    const sum = candidate.reduce((s, c) => s + c.a, 0);
    const max = Math.max(...candidate.map((c) => c.a));
    const min = Math.min(...candidate.map((c) => c.a));
    const s2 = side * side;
    const sum2 = sum * sum;
    return Math.max((s2 * max) / sum2, sum2 / (s2 * min));
  };

  const layoutRow = (
    candidate: { file: TreemapFile; a: number }[],
  ): void => {
    const sum = candidate.reduce((s, c) => s + c.a, 0);
    const horizontal = free.w >= free.h;
    if (horizontal) {
      const rowW = sum / free.h;
      let y = free.y;
      for (const c of candidate) {
        const h = c.a / rowW;
        placed.push({ x: free.x, y, w: rowW, h, file: c.file });
        y += h;
      }
      free = { x: free.x + rowW, y: free.y, w: free.w - rowW, h: free.h };
    } else {
      const rowH = sum / free.w;
      let x = free.x;
      for (const c of candidate) {
        const w = c.a / rowH;
        placed.push({ x, y: free.y, w, h: rowH, file: c.file });
        x += w;
      }
      free = { x: free.x, y: free.y + rowH, w: free.w, h: free.h - rowH };
    }
  };

  for (const item of scaled) {
    const side = shortestSide();
    const withItem = [...row, item];
    if (row.length === 0 || worst(withItem, side) <= worst(row, side)) {
      row = withItem;
    } else {
      layoutRow(row);
      row = [item];
    }
  }
  if (row.length > 0) layoutRow(row);

  return placed;
}

function colourFor(kind: string, t: number): string {
  // t in [0,1] — larger tile = more saturated. "god" → amber, "hotspot" → red,
  // anything else → muted slate.
  const alpha = 0.35 + 0.45 * Math.min(1, Math.max(0, t));
  if (kind === "god") return `rgba(240, 198, 116, ${alpha})`;
  if (kind === "hotspot") return `rgba(240, 128, 128, ${alpha})`;
  return `rgba(139, 149, 168, ${alpha})`;
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

export function Treemap({
  data,
  width = 640,
  height = 320,
}: TreemapProps): JSX.Element {
  const [hover, setHover] = useState<PlacedTile | null>(null);

  const tiles = useMemo(() => {
    const files = [...data.files]
      .filter((f) => Number.isFinite(f.size) && f.size > 0)
      .sort((a, b) => b.size - a.size);
    return squarify(files, { x: 0, y: 0, w: width, h: height });
  }, [data.files, width, height]);

  const maxSize = useMemo(
    () => tiles.reduce((m, t) => Math.max(m, t.file.size), 1),
    [tiles],
  );

  if (tiles.length === 0) {
    return (
      <div
        className="treemap-empty"
        style={{ width, height }}
        data-testid="treemap-empty"
      >
        no per-file hotspots reported for this repo
      </div>
    );
  }

  return (
    <div className="treemap-wrap" style={{ width }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Per-file architectural hotspots treemap"
        data-testid="treemap"
      >
        {tiles.map((t, i) => {
          const showLabel = t.w > 56 && t.h > 18;
          return (
            <g
              key={`${t.file.path}-${i}`}
              onMouseEnter={() => setHover(t)}
              onMouseLeave={() => setHover(null)}
              data-testid="treemap-tile"
            >
              <rect
                x={t.x}
                y={t.y}
                width={Math.max(0, t.w - 1)}
                height={Math.max(0, t.h - 1)}
                fill={colourFor(t.file.kind, t.file.size / maxSize)}
                stroke="rgba(12, 15, 20, 0.85)"
                strokeWidth={1}
                rx={2}
              />
              {showLabel && (
                <text
                  x={t.x + 6}
                  y={t.y + 14}
                  fontSize={11}
                  fill="rgba(12, 15, 20, 0.92)"
                  fontFamily="ui-monospace, Menlo, monospace"
                >
                  {basename(t.file.path)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="treemap-meta">
        {hover ? (
          <span data-testid="treemap-tooltip">
            <code>{hover.file.path}</code> — {hover.file.kind}, magnitude{" "}
            {hover.file.size}
          </span>
        ) : (
          <span>
            {tiles.length} files · max blast radius {data.max_blast_radius}
            {data.max_blast_file ? ` (${basename(data.max_blast_file)})` : ""} ·{" "}
            {data.attack_surface_files} files in attack surface
          </span>
        )}
      </div>
    </div>
  );
}
