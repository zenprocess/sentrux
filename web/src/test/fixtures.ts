import type {
  IndicatorKey,
  IndicatorReading,
  RulesResponse,
  ScoreResponse,
  TreemapResponse,
} from "../api/types";

export const SAMPLE_INDICATORS: Record<IndicatorKey, IndicatorReading> = {
  acyclicity: { value: 0.1111, weight: 0.2, contribution: 2.22 },
  depth: { value: 0.5714, weight: 0.2, contribution: 11.43 },
  equality: { value: 0.4375, weight: 0.2, contribution: 8.75 },
  modularity: { value: 0.5533, weight: 0.2, contribution: 11.07 },
  redundancy: { value: 0.641, weight: 0.2, contribution: 12.82 },
};

export const SAMPLE_SCORE: ScoreResponse = {
  repo: "/app/data/repos/argus",
  score: 40,
  score_normalized: 0.3969,
  scanned_at: "2026-05-11T15:12:14.027Z",
  source: "sentrux 0.5.7+serve.1",
  indicators: SAMPLE_INDICATORS,
  diagnostics: {
    complex_fn_count: 489,
    coupling_score: 0.15098,
    cycle_count: 8,
    god_file_count: 3,
    hotspot_count: 0,
    max_depth: 6,
  },
  baseline: null,
  delta: null,
};

export const SAMPLE_SCORE_WITH_BASELINE: ScoreResponse = {
  ...SAMPLE_SCORE,
  baseline: {
    score: 35,
    set_at: "2026-04-30T09:00:00.000Z",
    set_by: "api",
    indicators: {
      acyclicity: 0.1,
      depth: 0.5,
      equality: 0.4,
      modularity: 0.5,
      redundancy: 0.6,
    },
  },
  delta: 5,
};

export const SAMPLE_TREEMAP: TreemapResponse = {
  repo: "/app/data/repos/argus",
  treemap: {
    files: [
      { path: "src/core/scanner.rs", size: 41, kind: "god" },
      { path: "src/metrics/health.rs", size: 28, kind: "god" },
      { path: "src/app/mcp_server.rs", size: 19, kind: "hotspot" },
      { path: "src/cli/main.rs", size: 12, kind: "hotspot" },
      { path: "src/lib.rs", size: 7, kind: "other" },
    ],
    max_blast_file: "src/core/scanner.rs",
    max_blast_radius: 219,
    attack_surface_files: 160,
  },
};

export const SAMPLE_RULES: RulesResponse = {
  repo: "/app/data/repos/argus",
  rules_loaded: true,
  rules_checked: 4,
  violations: [
    {
      severity: "error",
      rule: "MaxCycles",
      message: "8 circular dependencies exceeds limit of 0",
      files: ["src/a.rs", "src/b.rs", "src/c.rs"],
    },
    {
      severity: "warning",
      rule: "MaxGodFiles",
      message: "3 god files exceeds limit of 1",
      files: ["src/core/scanner.rs"],
    },
  ],
  violation_count: 2,
};

export const SAMPLE_RULES_NONE: RulesResponse = {
  repo: "/app/data/repos/argus",
  rules_loaded: false,
  violations: [],
  violation_count: 0,
  message: "no .sentrux/rules.toml in repo",
};
