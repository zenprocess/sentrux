---
name: sentrux-serve
description: Query the sentrux HTTP daemon for architectural-quality scores, baselines, rules violations, git evolution (churn/hotspots/coupling), DSM (Design Structure Matrix), test-coverage gaps, and treemap data. Mirrors the surface that `sentrux mcp` exposes to AI agents, but over HTTP. Use when a sentrux daemon is running on localhost.
---

# sentrux-serve — REST API skill

Sibling to sentrux's MCP integration. The two surfaces wrap the same scoring engine:

| Workflow | Use MCP (`sentrux mcp`) | Use serve (`sentrux serve`) |
|---|---|---|
| Single-repo agent loop, stateful within one session | ✅ default | works but stateless across calls |
| Multi-repo dashboard / web UI | — (stdio only) | ✅ default |
| CI / cron / scripted check | works (one-shot) | ✅ caches across calls |
| Aggregator that needs `curl`-able JSON | — | ✅ |

## Daemon discovery

Default listen: `127.0.0.1:8103`. Start with:

```bash
sentrux serve --listen 127.0.0.1:8103 \
              --watch /path/to/repos \
              --state-dir ~/.local/share/sentrux/state
```

`--watch <dir>` is optional. With it, every immediate child of `<dir>` is treated as a repo, scored on launch, and rescored via `notify` on filesystem changes (2s debounce). Without `--watch`, use `POST /scan` for explicit scan-and-cache, or `/score` will lazy-resolve if a watch dir is set.

## Routes (MCP-parity surface)

| Route | MCP equivalent | Purpose |
|---|---|---|
| `GET /health` | `health` (server-side) | `{status, version, repos_indexed}` — daemon liveness probe. |
| `POST /scan` body `{path, repo_name?}` | `scan` | Force-scan a path, cache as `repo_name` (or basename). Returns same payload as `/score`. |
| `GET /score?repo=<name>` | `health` (the per-repo metrics view) | Composite score (0-100) + 5 indicators (modularity/acyclicity/depth/equality/redundancy) + diagnostics + baseline + delta. **The default starting query.** |
| `GET /baseline?repo=<name>` | `session_end` (read side) | Saved baseline + current score + delta. |
| `POST /baseline?repo=<name>` body `{"action":"set"}` or `{"action":"reset"}` | `session_start` / reset | Pin or clear baseline. |
| `GET /rules?repo=<name>` | `check_rules` | Loads `.sentrux/rules.toml`, runs the rules engine, returns violations. Empty = pass. |
| `POST /rescan?repo=<name>` | `rescan` | Force a fresh scan; bypasses watcher debounce. |
| `GET /evolution?repo=<name>&days=<N>` | `git_stats` | Git history analysis: churn, top hotspots, single-author ratio, coupling pairs. Requires `.git/` in the repo. |
| `GET /dsm?repo=<name>&format=text\|stats` | `dsm` | Design Structure Matrix: NxN dependency matrix, propagation cost, clusters, layering inversions. |
| `GET /test-gaps?repo=<name>&limit=<N>` | `test_gaps` | High-risk source files with zero test coverage; ranked by complexity × fan-in. |
| `GET /treemap?repo=<name>` | — (serve-specific) | Per-file blast-radius / god-file / hotspot data for treemap UIs. |

Errors return `{error: {code, message}}` with the appropriate HTTP status. Common codes: `MISSING_REPO` (400), `REPO_NOT_INDEXED` / `REPO_PATH_UNRESOLVABLE` (404), `DISABLED` (503 when `$SENTRUX_DISABLED_FLAG` exists), `SCORE_FAILED` / `EVOLUTION_FAILED` / `SCAN_FAILED` (500).

## Workflow patterns

### 1. "Is this repo's architecture healthy?"

```bash
curl -s 'http://127.0.0.1:8103/score?repo=myproj' \
  | jq '{score, weakest: (.indicators | to_entries | min_by(.value.value) | .key)}'
```

Composite is 0-100 (50 ≈ median, 80+ healthy). Lowest indicator is where to focus effort — the geometric mean is dominated by the weakest dimension.

### 2. "Did my last refactor improve things?"

```bash
# Before
curl -s -X POST 'http://127.0.0.1:8103/baseline?repo=myproj' \
     -H 'Content-Type: application/json' -d '{"action":"set"}'

# After
curl -s 'http://127.0.0.1:8103/baseline?repo=myproj' | jq '.delta'
```

Positive delta = improvement; negative = regression.

### 3. "Which rules am I currently violating?"

```bash
curl -s 'http://127.0.0.1:8103/rules?repo=myproj' \
  | jq '.violations[] | {severity, rule, message, files: (.files | length)}'
```

### 4. "Where should I refactor first?"

```bash
# Hotspots = high churn × high complexity
curl -s 'http://127.0.0.1:8103/evolution?repo=myproj&days=90' \
  | jq '.top_hotspots[] | {file, risk_score, churn, complexity}'

# Test gaps = untested + high-risk
curl -s 'http://127.0.0.1:8103/test-gaps?repo=myproj&limit=10' \
  | jq '.riskiest_untested[] | {file, risk_score, complexity, fan_in}'
```

The intersection (high-churn AND high-complexity AND untested) is where regressions are most likely.

### 5. "Is the layering clean?"

```bash
curl -s 'http://127.0.0.1:8103/dsm?repo=myproj' \
  | jq '{above_diag: .above_diagonal, density, propagation_cost, interpretation}'
```

`above_diagonal == 0` = all dependencies flow downward (clean layering). Anything > 20% of edges = significant inversions worth investigating.

### 6. "Watch a repo for live regressions"

Launch the daemon with `--watch <parent_dir>` and poll:

```bash
while true; do
  curl -s 'http://127.0.0.1:8103/score?repo=myproj' | jq '.score, .delta'
  sleep 60
done
```

The watcher rescores on filesystem changes; you'll see drift in real time.

## Anti-patterns

- **Don't fork-and-shim a CLI loop** when the daemon is reachable. The daemon caches scans; a cold `sentrux check` pays the full scan cost every time.
- **Don't expose the daemon externally without a reverse proxy.** It's loopback-only by default for a reason — no TLS, no auth.
- **Don't `POST /baseline action=set` after every commit.** Baselines exist to detect regression; auto-pinning hides exactly what they're meant to surface.
- **Don't call `/rescan` in tight loops.** Let the watcher debounce normal edits.
- **Don't query `/evolution` for repos with no git history.** It will fail with `EVOLUTION_FAILED`. Probe `.git/` first if uncertain.

## Score interpretation

| Indicator | What it captures | Low-score remedy |
|---|---|---|
| modularity | Cluster cleanness (Girvan-Newman Q on the import graph). 1.0 = perfectly siloed, 0 = single hairball. | Move tightly-coupled files into shared modules; break cross-module imports. |
| acyclicity | `1 / (1 + cycle_count)`. 1.0 = DAG, drops fast as cycles appear. | Find cycles via `/dsm` or `/score.diagnostics.cycle_count`; pick the weakest edge in each; invert the dependency. |
| depth | `1 / (1 + max_depth/8)`. Penalises towers of 8+ levels. | Flatten layered abstractions; merge thin pass-through layers. |
| equality | `1 - complexity_gini`. 1.0 = complexity evenly distributed. | Refactor the top-CC functions reported in `/score.diagnostics.complex_fn_count`. |
| redundancy | `1 - duplication_ratio`. 1.0 = no copy-paste. | Extract duplicated function bodies. |

The composite is the geometric mean of the five — pulled down by the weakest, not the average. Always start with the lowest indicator.
