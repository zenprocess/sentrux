// Types mirror the wire contract of the sentrux quality daemon.
// Source of truth: sentrux-bin/src/serve.rs route handlers.

export type IndicatorKey =
  | "acyclicity"
  | "depth"
  | "equality"
  | "modularity"
  | "redundancy";

export const INDICATOR_ORDER: readonly IndicatorKey[] = [
  "acyclicity",
  "depth",
  "equality",
  "modularity",
  "redundancy",
] as const;

export const INDICATOR_LABELS: Record<IndicatorKey, string> = {
  acyclicity: "Acyclicity",
  depth: "Depth",
  equality: "Equality",
  modularity: "Modularity",
  redundancy: "Redundancy",
};

export interface IndicatorReading {
  value: number;
  weight: number;
  contribution: number;
}

export interface Diagnostics {
  complex_fn_count: number;
  coupling_score: number;
  cycle_count: number;
  god_file_count: number;
  hotspot_count: number;
  max_depth: number;
}

export type Verdict = "READY" | "CONDITIONAL" | "BLOCK";

export interface ScoreResponse {
  repo: string;
  score: number;
  score_normalized: number;
  scanned_at: string;
  source: string;
  indicators: Record<IndicatorKey, IndicatorReading>;
  diagnostics: Diagnostics;
  baseline: ScoreResponse | null;
  delta: number | null;
}

export interface BaselineResponse {
  repo: string;
  baseline: ScoreResponse | null;
  current_score: number | null;
  delta: number | null;
}

export interface HealthResponse {
  status: string;
  version: string;
  repos_indexed?: number;
}

export interface DaemonError {
  error: { code: string; message: string };
}

/**
 * Map a composite score (0–100) to a deploy/merge verdict.
 *
 * These thresholds are conservative defaults; the daemon may eventually expose
 * its own configured cutoffs (e.g. via `.sentrux/rules.toml`), at which point
 * the UI should defer to the wire response. For now the cutoffs live here so
 * the GUI is usable against an unconfigured repo.
 */
export function verdictFor(score: number): Verdict {
  if (score >= 70) return "READY";
  if (score >= 40) return "CONDITIONAL";
  return "BLOCK";
}
