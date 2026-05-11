# Phase 2 roadmap

The Phase 2 MVP delivered a standalone Vite/React GUI that consumes a
running `sentrux serve` daemon and renders the five indicators, composite
score, verdict and diagnostics. Phase 2.1 (this iteration) folds in binary
embedding, the treemap, the baseline-diff overlay and the rules panel.

## Phase 2.1 — GUI enrichment — DONE

- **Binary embedding** — `web/dist/` is baked into the `sentrux` binary via
  `rust-embed` (`sentrux-bin/src/assets.rs`). `sentrux serve` serves the SPA
  at `GET /`, hashed assets at `/assets/*` (with `immutable` cache headers),
  and falls back to `index.html` for client-side routes. The JSON API routes
  are matched ahead of the `/*path` wildcard, so nothing shadows them.
  `web/dist/` is committed (see `web/.gitignore`) so a plain `cargo build`
  yields a working GUI; rebuild + recommit it after touching `web/src/`.
  - Build flow: `cd web && npm run build` then `cargo build --release`.
  - No `--no-gui` flag was added — the embedded payload is ~73 KB gzipped
    JS + ~2 KB gzipped CSS (well under the ~250 KB envelope), so there is
    nothing to opt out of. Revisit if the payload ever grows materially.
- **Treemap** (`web/src/components/Treemap.tsx`) — squarified treemap of the
  per-file hotspots from `/treemap?repo=...`, sized by the daemon-reported
  magnitude and coloured by kind (`god` → amber, `hotspot` → red). Hover
  shows file path + kind + magnitude; the summary line shows max blast
  radius and attack-surface size. Hand-rolled pure-SVG layout — no
  `@visx/hierarchy` dependency, keeping the bundle small. Tab alongside the
  radar. Note `/treemap` only serves repos the daemon has already scored, so
  the Treemap tab fetches lazily after `/score` has run (or relies on
  `--watch`).
- **Baseline diff overlay** — the daemon's `Baseline` now also persists the
  five indicator values at baseline-set time (`sentrux-bin/src/serve.rs`),
  surfaced through both `/baseline` and `/score`'s `baseline` field. The GUI
  adds a "vs baseline" toggle that overlays the recorded baseline as a faint
  dashed polygon on the radar and shows per-indicator deltas in the point
  tooltips. The composite delta is already rendered on the score banner.
  Baselines set before this change have no `indicators` payload — the toggle
  then explains that re-setting the baseline enables the overlay.
- **Rules panel** (`web/src/components/RulesPanel.tsx`) — read-only table of
  `/rules?repo=...` output: severity badge, rule name, message, affected
  files, plus a "rules loaded" / "all pass" / "N violations" summary. No
  authoring — the daemon stays the source of truth.

## Phase 2.2 — historical trend (`/history`) — BLOCKED on daemon

- `sentrux serve` does not expose `GET /history?repo=...` — there is no
  per-day score series in the baseline store, only the current baseline. The
  `Sparkline` component still renders a placeholder; wiring it is a one-line
  client call once the endpoint exists.
- **Daemon work needed**: persist a daily composite-score series (e.g. under
  `state_dir/history/<repo>.jsonl`) and serve `GET /history?repo=...&days=N`
  → `{ "repo": ..., "points": [{ "day": "YYYY-MM-DD", "score": N }, ...] }`.

## Phase 2.6 — multi-repo comparison

- Repo picker grows into a multi-select, and the GUI batches
  `/score?repo=...` calls. Render side-by-side radars and a leaderboard
  on the composite score.

## Phase 3+

- Rescan trigger (`POST /rescan`) with a confirm modal.
- Drilldowns into the specific symbols contributing to each indicator
  (depends on a new daemon endpoint).
- Saved views / shareable URLs (`?repo=...&baseline=on`).

## Non-goals (explicitly out of scope)

- Authoring or editing `.sentrux/rules.toml` from the GUI — the daemon
  must remain the source of truth; the GUI is read-only.
- Coupling to any specific downstream consumer's design system.
- Authentication / RBAC — the daemon is currently expected to run
  locally on a trusted network; auth is a separate concern.
