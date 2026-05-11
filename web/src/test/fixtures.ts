import type { IndicatorKey, IndicatorReading, ScoreResponse } from "../api/types";

export const SAMPLE_INDICATORS: Record<IndicatorKey, IndicatorReading> = {
  acyclicity: { value: 0.1111, weight: 0.2, contribution: 2.22 },
  depth: { value: 0.5714, weight: 0.2, contribution: 11.43 },
  equality: { value: 0.4375, weight: 0.2, contribution: 8.75 },
  modularity: { value: 0.5533, weight: 0.2, contribution: 11.07 },
  redundancy: { value: 0.6410, weight: 0.2, contribution: 12.82 },
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
