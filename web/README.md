# sentrux web

A small standalone web GUI for the sentrux quality daemon. It consumes a
running `sentrux serve` HTTP daemon and renders the five architectural
indicators (acyclicity, depth, equality, modularity, redundancy), composite
score, verdict, baseline delta, diagnostics, a per-file hotspot treemap and
the repo's `.sentrux/rules.toml` enforcement result.

This GUI is consumer-agnostic — any downstream API consumer can host or
embed it. As of Phase 2.1 the built SPA (`web/dist/`) is also baked into the
`sentrux` binary, so `sentrux serve` serves it directly at `/`.

## Stack

- Vite 5 + React 18 + TypeScript (strict)
- @visx primitives for the radar chart; the treemap is a hand-rolled
  squarified layout (pure SVG, no chart-library bloat)
- Vitest + Testing Library for component + API client tests
- No runtime dependencies on the host page beyond a modern browser

## Run

Start the daemon (anywhere reachable from the browser):

```bash
sentrux serve --listen 127.0.0.1:8103 --watch /path/to/repos &
curl -sf http://127.0.0.1:8103/health
```

### Against the embedded GUI (no dev server)

```bash
cd web && npm install && npm run build   # produces web/dist/
cargo build --release                    # bakes web/dist/ into the binary
./target/release/sentrux serve --listen 127.0.0.1:8103 --watch /path/to/repos
# open http://127.0.0.1:8103/
```

`web/dist/` is committed, so a fresh checkout's `cargo build` already yields
a working GUI — the `npm run build` step is only needed after editing
anything under `web/src/` (then commit the regenerated `web/dist/` too).

### Dev server (live reload)

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
# emits web/dist/ — static, served from any HTTP server, and embedded into
# the `sentrux` binary (see sentrux-bin/src/assets.rs).
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

| Endpoint    | Used for                                                  |
|-------------|-----------------------------------------------------------|
| `/health`   | header status (daemon version + repo count)               |
| `/score`    | composite score, verdict, indicator readings, diagnostics, per-indicator baseline overlay |
| `/baseline` | "vs baseline" composite delta                             |
| `/treemap`  | per-file hotspot treemap (Treemap tab)                    |
| `/rules`    | `.sentrux/rules.toml` violations table (Rules tab, read-only) |

`/history` is not consumed yet — the daemon does not expose it. The
`Sparkline` component renders a placeholder until `GET /history?repo=...`
exists.

## Layout

```
web/
  index.html
  vite.config.ts
  tsconfig.json
  dist/             committed build output — embedded into the binary
  src/
    api/
      types.ts        wire types (mirrors serve.rs handlers)
      client.ts       DaemonClient — fetch wrapper, base-URL resolver
    components/
      ScoreBanner.tsx       score number + verdict pill + scanned-at
      RadarChart.tsx        5-axis radar over @visx, optional baseline overlay
      Treemap.tsx           squarified per-file hotspot treemap (pure SVG)
      RulesPanel.tsx        read-only .sentrux/rules.toml violations table
      Sparkline.tsx         30-day trend (placeholder until /history lands)
      DiagnosticsGrid.tsx   complex fns / cycles / god files / coupling
    App.tsx           page shell, repo input, tab switcher, state machine
    main.tsx
    styles.css        dark theme, no design-system coupling
  README.md
```

## Roadmap

See [`docs/PHASE-2-ROADMAP.md`](../docs/PHASE-2-ROADMAP.md). Phase 2.1
(binary embedding, treemap, baseline diff, rules panel) shipped here;
`/history` (Phase 2.2) is blocked on a daemon endpoint.
