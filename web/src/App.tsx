import { useCallback, useEffect, useState } from "react";
import { DaemonClient, defaultClient } from "./api/client";
import type { HealthResponse, ScoreResponse } from "./api/types";
import { RadarChart } from "./components/RadarChart";
import { ScoreBanner } from "./components/ScoreBanner";
import { Sparkline } from "./components/Sparkline";
import { DiagnosticsGrid } from "./components/DiagnosticsGrid";

const REPO_STORAGE_KEY = "sentrux.repo";
const DEFAULT_REPO = "/app/data/repos/argus";

interface AppProps {
  client?: DaemonClient;
}

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; data: ScoreResponse }
  | { kind: "error"; message: string };

export function App({ client = defaultClient }: AppProps): JSX.Element {
  const [repo, setRepo] = useState<string>(() => {
    try {
      return localStorage.getItem(REPO_STORAGE_KEY) ?? DEFAULT_REPO;
    } catch {
      return DEFAULT_REPO;
    }
  });
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [state, setState] = useState<FetchState>({ kind: "idle" });

  const fetchScore = useCallback(
    async (target: string) => {
      setState({ kind: "loading" });
      try {
        const data = await client.score(target);
        setState({ kind: "ok", data });
      } catch (e) {
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        });
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

  useEffect(() => {
    void fetchScore(repo);
  }, [repo, fetchScore]);

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
        {state.kind === "loading" && (
          <div className="status-card" data-testid="loading">
            scoring {repo}…
          </div>
        )}

        {state.kind === "error" && (
          <div className="status-card status-error" data-testid="error">
            <strong>could not load score</strong>
            <code>{state.message}</code>
            <p className="hint">
              The daemon must be running on the URL configured at build time
              (defaults to same-origin), and the repo path must be indexed.
            </p>
          </div>
        )}

        {state.kind === "ok" && (
          <>
            <ScoreBanner
              score={state.data.score}
              scannedAt={state.data.scanned_at}
              source={state.data.source}
              delta={state.data.delta}
            />

            <section className="panels">
              <div className="panel panel-radar">
                <h2>Indicators</h2>
                <RadarChart
                  indicators={state.data.indicators}
                  baseline={state.data.baseline?.indicators ?? null}
                />
              </div>
              <div className="panel panel-side">
                <h2>30-day trend</h2>
                <Sparkline data={null} />
                <h2>Diagnostics</h2>
                <DiagnosticsGrid diagnostics={state.data.diagnostics} />
              </div>
            </section>
          </>
        )}
      </main>

      <footer className="app-footer">
        <span>
          GUI consumes <code>/score</code>, <code>/health</code>,{" "}
          <code>/baseline</code>. Static build ships in <code>web/dist/</code>.
        </span>
      </footer>
    </div>
  );
}
