# sentrux web (Phase 2 MVP)

A small standalone web GUI for the sentrux quality daemon. It consumes a
running `sentrux serve` HTTP daemon and renders the five architectural
indicators (acyclicity, depth, equality, modularity, redundancy), composite
score, verdict, baseline delta and diagnostics.

This GUI is consumer-agnostic — any downstream API consumer can host or
embed it. The Phase 2 MVP intentionally ships as a standalone Vite build
in `web/dist/`; binary embedding (`include_dir!()`) is queued for Phase 2.1.

## Stack

- Vite 5 + React 18 + TypeScript (strict)
- @visx primitives for the radar chart (no chart library bloat)
- Vitest + Testing Library for component + API client tests
- No runtime dependencies on the host page beyond a modern browser

## Run

Start the daemon (anywhere reachable from the browser):

```bash
sentrux serve --listen 127.0.0.1:8103 --watch /path/to/repos &
curl -sf http://127.0.0.1:8103/health
```

Run the dev server:

```bash
cd web
npm install
npm run dev
# open http://localhost:5180
```

The dev server proxies `/api/*` → `http://127.0.0.1:8103/*`. Override the
target via `VITE_DAEMON_URL=http://other-host:8103 npm run dev`.

## Build

```bash
cd web
npm run build
# emits web/dist/ — static, ready to serve from any HTTP server,
# including `sentrux serve` once binary asset embedding lands (Phase 2.1).
```

If the GUI is going to be hosted at a different origin than the daemon, set
`VITE_DAEMON_URL` at build time:

```bash
VITE_DAEMON_URL=https://quality.example.com npm run build
```

## Test

```bash
cd web
npm test           # vitest run
npm run test:watch # watch mode
```

## Endpoints consumed

| Endpoint    | Used for                                                 |
|-------------|----------------------------------------------------------|
| `/health`   | header status (daemon version + repo count)              |
| `/score`    | composite score, verdict, indicator readings, diagnostics |
| `/baseline` | reserved for upcoming baseline-overlay variant           |

## Layout

```
web/
  index.html
  vite.config.ts
  tsconfig.json
  src/
    api/
      types.ts        wire types (mirrors serve.rs handlers)
      client.ts       DaemonClient — fetch wrapper, base-URL resolver
    components/
      ScoreBanner.tsx       score number + verdict pill + scanned-at
      RadarChart.tsx        5-axis radar over @visx
      Sparkline.tsx         30-day trend (placeholder until /history lands)
      DiagnosticsGrid.tsx   complex fns / cycles / god files / coupling
    App.tsx           page shell, repo input, state machine
    main.tsx
    styles.css        dark theme, no design-system coupling
  README.md
```

## Roadmap

See [`docs/PHASE-2-ROADMAP.md`](../docs/PHASE-2-ROADMAP.md) for the queue of
items intentionally deferred from this MVP.
