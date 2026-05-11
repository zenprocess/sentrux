import { useCallback, useEffect, useMemo, useState } from "react";
import { DaemonClient, defaultClient } from "./api/client";
import type {
  HealthResponse,
  IndicatorKey,
  IndicatorReading,
  RulesResponse,
  ScoreResponse,
  TreemapResponse,
} from "./api/types";
import { RadarChart } from "./components/RadarChart";
import { ScoreBanner } from "./components/ScoreBanner";
import { Sparkline } from "./components/Sparkline";
import { DiagnosticsGrid } from "./components/DiagnosticsGrid";
import { Treemap } from "./components/Treemap";
import { RulesPanel } from "./components/RulesPanel";

const REPO_STORAGE_KEY = "sentrux.repo";
const DEFAULT_REPO = "/app/data/repos/argus";

type TabKey = "indicators" | "treemap" | "rules";

interface AppProps {
  client?: DaemonClient;
}

type FetchState<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; data: T }
  | { kind: "error"; message: string };

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Adapt a daemon baseline's per-indicator values (plain numbers) into the
 * `IndicatorReading` shape the radar's `baseline` prop expects. Returns null
 * when the daemon did not persist per-indicator data with the baseline (older
 * daemons, or a baseline set before Phase 2.1).
 */
function baselineReadings(
  ind: Record<IndicatorKey, number> | null | undefined,
): Record<IndicatorKey, IndicatorReading> | null {
  if (!ind) return null;
  const out = {} as Record<IndicatorKey, IndicatorReading>;
  for (const k of Object.keys(ind) as IndicatorKey[]) {
    out[k] = { value: ind[k], weight: 0.2, contribution: ind[k] * 20 };
  }
  return out;
}

export function App({ client = defaultClient }: AppProps): JSX.Element {
  const [repo, setRepo] = useState<string>(() => {
    try {
      return localStorage.getItem(REPO_STORAGE_KEY) ?? DEFAULT_REPO;
    } catch {
      return DEFAULT_REPO;
    }
  });
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [tab, setTab] = useState<TabKey>("indicators");
  const [showBaseline, setShowBaseline] = useState(false);

  const [score, setScore] = useState<FetchState<ScoreResponse>>({
    kind: "idle",
  });
  const [treemap, setTreemap] = useState<FetchState<TreemapResponse>>({
    kind: "idle",
  });
  const [rules, setRules] = useState<FetchState<RulesResponse>>({
    kind: "idle",
  });

  const fetchScore = useCallback(
    async (target: string) => {
      setScore({ kind: "loading" });
      try {
        setScore({ kind: "ok", data: await client.score(target) });
      } catch (e) {
        setScore({ kind: "error", message: errMsg(e) });
      }
    },
    [client],
  );

  const fetchTreemap = useCallback(
    async (target: string) => {
      setTreemap({ kind: "loading" });
      try {
        setTreemap({ kind: "ok", data: await client.treemap(target) });
      } catch (e) {
        setTreemap({ kind: "error", message: errMsg(e) });
      }
    },
    [client],
  );

  const fetchRules = useCallback(
    async (target: string) => {
      setRules({ kind: "loading" });
      try {
        setRules({ kind: "ok", data: await client.rules(target) });
      } catch (e) {
        setRules({ kind: "error", message: errMsg(e) });
      }
    },
    [client],
  );

  useEffect(() => {
    void client
      .health()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, [client]);

  // The score view is the landing tab — always fetch it on repo change. The
  // treemap and rules tabs are lazy: they fetch the first time they're opened
  // for a given repo (and re-fetch when the repo changes while open).
  useEffect(() => {
    void fetchScore(repo);
    setTreemap({ kind: "idle" });
    setRules({ kind: "idle" });
  }, [repo, fetchScore]);

  useEffect(() => {
    if (tab === "treemap" && treemap.kind === "idle") void fetchTreemap(repo);
    if (tab === "rules" && rules.kind === "idle") void fetchRules(repo);
  }, [tab, repo, treemap.kind, rules.kind, fetchTreemap, fetchRules]);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const next = String(form.get("repo") ?? "").trim();
    if (!next) return;
    try {
      localStorage.setItem(REPO_STORAGE_KEY, next);
    } catch {
      /* storage may be unavailable; non-fatal */
    }
    setRepo(next);
  };

  const baselineForRadar = useMemo(
    () =>
      showBaseline && score.kind === "ok"
        ? baselineReadings(score.data.baseline?.indicators)
        : null,
    [showBaseline, score],
  );

  const hasBaseline = score.kind === "ok" && score.data.baseline != null;

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ◆
          </span>
          <span className="brand-name">sentrux</span>
        </div>
        <div className="header-status" data-testid="header-status">
          {health ? (
            <>
              <span className="dot dot-ok" />
              daemon {health.version}
              {typeof health.repos_indexed === "number" &&
                ` · ${health.repos_indexed} repos`}
            </>
          ) : (
            <>
              <span className="dot dot-bad" />
              daemon unreachable
            </>
          )}
        </div>
      </header>

      <form className="repo-form" onSubmit={onSubmit}>
        <label htmlFor="repo-input">Repo path</label>
        <input
          id="repo-input"
          name="repo"
          type="text"
          defaultValue={repo}
          placeholder="/app/data/repos/<slug>"
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit">Score</button>
      </form>

      <main className="content">
        {score.kind === "loading" && (
          <div className="status-card" data-testid="loading">
            scoring {repo}…
          </div>
        )}

        {score.kind === "error" && (
          <div className="status-card status-error" data-testid="error">
            <strong>could not load score</strong>
            <code>{score.message}</code>
            <p className="hint">
              The daemon must be running on the URL configured at build time
              (defaults to same-origin), and the repo path must be indexed.
            </p>
          </div>
        )}

        {score.kind === "ok" && (
          <>
            <ScoreBanner
              score={score.data.score}
              scannedAt={score.data.scanned_at}
              source={score.data.source}
              delta={score.data.delta}
            />

            <nav className="tabbar" data-testid="tabbar" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "indicators"}
                className={tab === "indicators" ? "tab tab-active" : "tab"}
                onClick={() => setTab("indicators")}
                data-testid="tab-indicators"
              >
                Indicators
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "treemap"}
                className={tab === "treemap" ? "tab tab-active" : "tab"}
                onClick={() => setTab("treemap")}
                data-testid="tab-treemap"
              >
                Treemap
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "rules"}
                className={tab === "rules" ? "tab tab-active" : "tab"}
                onClick={() => setTab("rules")}
                data-testid="tab-rules"
              >
                Rules
              </button>
            </nav>

            {tab === "indicators" && (
              <section className="panels">
                <div className="panel panel-radar">
                  <div className="panel-head">
                    <h2>Indicators</h2>
                    <label
                      className={
                        hasBaseline
                          ? "baseline-toggle"
                          : "baseline-toggle baseline-toggle-disabled"
                      }
                      title={
                        hasBaseline
                          ? "Overlay the recorded baseline on the radar"
                          : "No baseline recorded for this repo (POST /baseline {action:'set'})"
                      }
                    >
                      <input
                        type="checkbox"
                        checked={showBaseline}
                        disabled={!hasBaseline}
                        onChange={(e) => setShowBaseline(e.target.checked)}
                        data-testid="baseline-toggle"
                      />
                      vs baseline
                    </label>
                  </div>
                  <RadarChart
                    indicators={score.data.indicators}
                    baseline={baselineForRadar}
                  />
                  {showBaseline &&
                    hasBaseline &&
                    !score.data.baseline?.indicators && (
                      <p className="baseline-note" data-testid="baseline-note">
                        baseline composite is {score.data.baseline?.score} (
                        {score.data.delta != null
                          ? `${score.data.delta >= 0 ? "+" : ""}${score.data.delta} now`
                          : "no delta"}
                        ) — this baseline predates per-indicator capture, so the
                        radar overlay is unavailable. Re-set the baseline to
                        enable it.
                      </p>
                    )}
                </div>
                <div className="panel panel-side">
                  <h2>30-day trend</h2>
                  <Sparkline data={null} />
                  <h2>Diagnostics</h2>
                  <DiagnosticsGrid diagnostics={score.data.diagnostics} />
                </div>
              </section>
            )}

            {tab === "treemap" && (
              <section className="panel panel-wide">
                <h2>Per-file hotspots</h2>
                {treemap.kind === "loading" && (
                  <div className="status-card" data-testid="treemap-loading">
                    building treemap for {repo}…
                  </div>
                )}
                {treemap.kind === "error" && (
                  <div
                    className="status-card status-error"
                    data-testid="treemap-error"
                  >
                    <strong>could not load treemap</strong>
                    <code>{treemap.message}</code>
                    <p className="hint">
                      The daemon only serves a treemap for repos it has already
                      scored — open the Indicators tab first (or run the daemon
                      with <code>--watch</code>).
                    </p>
                  </div>
                )}
                {treemap.kind === "ok" && (
                  <Treemap data={treemap.data.treemap} />
                )}
              </section>
            )}

            {tab === "rules" && (
              <section className="panel panel-wide">
                <h2>Architectural rules</h2>
                {rules.kind === "loading" && (
                  <div className="status-card" data-testid="rules-loading">
                    checking rules for {repo}…
                  </div>
                )}
                {rules.kind === "error" && (
                  <div
                    className="status-card status-error"
                    data-testid="rules-error"
                  >
                    <strong>could not load rules</strong>
                    <code>{rules.message}</code>
                  </div>
                )}
                {rules.kind === "ok" && <RulesPanel rules={rules.data} />}
              </section>
            )}
          </>
        )}
      </main>

      <footer className="app-footer">
        <span>
          GUI consumes <code>/score</code>, <code>/health</code>,{" "}
          <code>/baseline</code>, <code>/treemap</code>, <code>/rules</code>.
          Static build ships in <code>web/dist/</code> and is embedded into the
          daemon binary.
        </span>
      </footer>
    </div>
  );
}
