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

/**
 * A persisted baseline as the daemon stores it: a composite score plus the
 * five indicator values captured at baseline-set time, with provenance.
 *
 * Older daemons (pre Phase-2.1) persisted only `{score, set_at, set_by}` —
 * `indicators` is therefore optional. When present it lets the radar draw a
 * real "vs baseline" overlay; when absent the GUI falls back to a
 * composite-only delta.
 */
export interface Baseline {
  score: number;
  set_at: string;
  set_by: string;
  indicators?: Record<IndicatorKey, number> | null;
}

export interface ScoreResponse {
  repo: string;
  score: number;
  score_normalized: number;
  scanned_at: string;
  source: string;
  indicators: Record<IndicatorKey, IndicatorReading>;
  diagnostics: Diagnostics;
  baseline: Baseline | null;
  delta: number | null;
}

export interface BaselineResponse {
  repo: string;
  baseline: Baseline | null;
  current_score: number | null;
  delta: number | null;
}

export interface HealthResponse {
  status: string;
  version: string;
  repos_indexed?: number;
}

// --- /treemap -------------------------------------------------------------

export type TreemapFileKind = "god" | "hotspot" | string;

export interface TreemapFile {
  path: string;
  /** Daemon-reported magnitude (fan-out / churn); used as the rect area. */
  size: number;
  kind: TreemapFileKind;
}

export interface TreemapData {
  files: TreemapFile[];
  max_blast_file: string | null;
  max_blast_radius: number;
  attack_surface_files: number;
}

export interface TreemapResponse {
  repo: string;
  treemap: TreemapData;
}

// --- /rules ---------------------------------------------------------------

export type RuleSeverity = "error" | "warning" | string;

export interface RuleViolation {
  severity: RuleSeverity;
  rule: string;
  message: string;
  files: string[];
}

export interface RulesResponse {
  repo: string;
  rules_loaded: boolean;
  rules_checked?: number;
  violations: RuleViolation[];
  violation_count: number;
  message?: string;
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
