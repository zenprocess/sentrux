import type {
  BaselineResponse,
  DaemonError,
  HealthResponse,
  ScoreResponse,
} from "./types";

/**
 * Resolve the daemon base URL.
 *
 * Priority:
 *   1. `VITE_DAEMON_URL` build-time env (e.g. when the SPA is hosted by a
 *      different process than the daemon).
 *   2. Same-origin (the production case — the daemon serves `dist/` itself or
 *      the page is reverse-proxied).
 *   3. In dev, vite's proxy rewrites `/api/*` → `http://127.0.0.1:8103/*`,
 *      so `/api` is a safe prefix.
 */
function resolveBase(): string {
  const fromEnv = import.meta.env.VITE_DAEMON_URL as string | undefined;
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/$/, "");
  if (import.meta.env.DEV) return "/api";
  return "";
}

export class DaemonClient {
  readonly base: string;

  constructor(base?: string) {
    this.base = base !== undefined ? base.replace(/\/$/, "") : resolveBase();
  }

  private url(path: string, params?: Record<string, string>): string {
    const qs = params
      ? "?" + new URLSearchParams(params).toString()
      : "";
    return `${this.base}${path}${qs}`;
  }

  private async fetchJson<T>(
    path: string,
    params?: Record<string, string>,
    init?: RequestInit,
  ): Promise<T> {
    const res = await fetch(this.url(path, params), init);
    if (!res.ok) {
      let detail = "";
      try {
        const body = (await res.json()) as DaemonError;
        detail = body.error?.message ?? body.error?.code ?? "";
      } catch {
        detail = await res.text().catch(() => "");
      }
      throw new Error(
        `daemon ${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}`,
      );
    }
    return (await res.json()) as T;
  }

  health(): Promise<HealthResponse> {
    return this.fetchJson<HealthResponse>("/health");
  }

  score(repo: string): Promise<ScoreResponse> {
    return this.fetchJson<ScoreResponse>("/score", { repo });
  }

  baseline(repo: string): Promise<BaselineResponse> {
    return this.fetchJson<BaselineResponse>("/baseline", { repo });
  }
}

export const defaultClient = new DaemonClient();
