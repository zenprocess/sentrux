import { verdictFor, type Verdict } from "../api/types";

interface ScoreBannerProps {
  score: number;
  scannedAt: string;
  source: string;
  delta?: number | null;
}

const verdictStyle: Record<Verdict, { bg: string; fg: string; label: string }> = {
  READY: { bg: "#143a26", fg: "#67d4a0", label: "READY" },
  CONDITIONAL: { bg: "#3a3014", fg: "#f0c674", label: "CONDITIONAL" },
  BLOCK: { bg: "#3a1818", fg: "#f08080", label: "BLOCK" },
};

export function ScoreBanner({
  score,
  scannedAt,
  source,
  delta,
}: ScoreBannerProps): JSX.Element {
  const verdict = verdictFor(score);
  const style = verdictStyle[verdict];

  const deltaLabel =
    delta == null
      ? null
      : delta === 0
        ? "no change"
        : `${delta > 0 ? "+" : ""}${delta.toFixed(0)} vs baseline`;

  return (
    <section
      className="score-banner"
      style={{ borderColor: style.fg }}
      data-testid="score-banner"
    >
      <div className="score-number" style={{ color: style.fg }}>
        <span data-testid="score-value">{score}</span>
        <span className="score-suffix">/100</span>
      </div>
      <div className="score-meta">
        <span
          className="verdict-pill"
          style={{ background: style.bg, color: style.fg }}
          data-testid="score-verdict"
        >
          {style.label}
        </span>
        {deltaLabel && (
          <span className="score-delta" data-testid="score-delta">
            {deltaLabel}
          </span>
        )}
        <span className="score-scanned-at" title={scannedAt}>
          scanned {scannedAt.slice(0, 19).replace("T", " ")} UTC
        </span>
        <span className="score-source">{source}</span>
      </div>
    </section>
  );
}
