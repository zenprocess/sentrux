# Phase 2 roadmap (post-MVP)

The Phase 2 MVP (this PR) delivers a standalone Vite/React GUI that consumes
a running `sentrux serve` daemon and renders the five indicators, composite
score, verdict and diagnostics. The items below are explicitly deferred.

## Phase 2.1 — binary embedding

- Wire `include_dir!()` (or `rust-embed`) over `web/dist/` so the daemon
  can serve the SPA from `GET /` when the `gui` feature is enabled.
- Add a `--no-gui` flag for headless deployments.
- Verify the embedded payload stays under ~250 KB gzipped (target moved
  upward from the original 50 KB envelope because @visx adds ~80 KB; if we
  need to hit 50 KB the radar can be reimplemented in pure SVG without
  @visx and the build can drop React entirely).

## Phase 2.2 — historical trend (`/history`)

- Add a `GET /history?repo=...&days=30` daemon endpoint that returns the
  per-day composite score from the existing baseline persistence.
- Replace the placeholder Sparkline in `web/src/components/Sparkline.tsx`
  with a real fetch — the component already renders any `number[]` passed
  to it, so the integration is a single client call.

## Phase 2.3 — baseline diff overlay

- The radar component already accepts an optional `baseline` series and
  draws it as a dashed polygon. The MVP wires this to
  `score.baseline?.indicators ?? null`. Phase 2.3 should:
  - Show a per-indicator diff (current − baseline) in tooltips.
  - Surface the daemon-reported `delta` more prominently on the score
    banner (it's already rendered when non-null).

## Phase 2.4 — treemap

- The daemon already exposes `/treemap?repo=...`. Add a `Treemap.tsx`
  panel using `@visx/hierarchy`. The wire shape is:

  ```json
  {
    "repo": "...",
    "treemap": {
      "attack_surface_files": 160,
      "files": [{ "kind": "god", "path": "...", "size": 41 }, ...],
      "max_blast_file": "...",
      "max_blast_radius": 219
    }
  }
  ```

## Phase 2.5 — rules panel

- Daemon exposes `/rules?repo=...` (returns 400 when the repo has no
  `.sentrux/rules.toml`; otherwise returns violations).
- Render the violations list and a "rules loaded" indicator. No
  authoring/editing in this phase — the GUI must remain read-only so the
  daemon stays the single source of truth.

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
