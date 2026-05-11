//! sentrux serve — HTTP daemon (axum) exposing scoring + baselines + rules.
//!
//! Mirrors the contract argus's /api/architectural/* proxy expects, and what
//! zendev-lite's /arch-quality, /arch-baseline, /arch-rules, /arch-watch
//! skills are coded against. See SPEC-651 for the full design.
//!
//! Loopback-only by default. CORS is permissive; assume operator wraps in
//! a reverse proxy if exposing externally.
//!
//! Scoring uses sentrux-core's existing public API:
//!   - analysis::scanner::scan_directory  → ScanResult { snapshot }
//!   - metrics::compute_health(&snapshot) → HealthReport (with quality_signal + 5 root-cause scores)
//!   - metrics::arch::compute_arch(&snapshot) → ArchReport (levelization + blast radius)
//!   - metrics::rules::{RulesConfig, check_rules} → RuleCheckResult

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;

use sentrux_core::analysis::{self, scanner::common::ScanLimits};
use sentrux_core::core::settings::Settings;
use sentrux_core::core::snapshot::Snapshot;
use sentrux_core::core::types::FileNode;
use sentrux_core::metrics::{
    self,
    rules::{check_rules, RulesConfig},
};

// --------------------------------------------------------------------------
// Public entry point
// --------------------------------------------------------------------------

pub async fn run(
    state: ServeState,
    listen: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let shared = Arc::new(state);

    if let Some(watch_dir) = shared.watch_dir.clone() {
        spawn_watch_scorer(shared.clone(), watch_dir);
    }

    let app = Router::new()
        .route("/health", get(handle_health))
        .route("/score", get(handle_score))
        .route("/baseline", get(handle_get_baseline).post(handle_post_baseline))
        .route("/rules", get(handle_get_rules))
        .route("/rescan", post(handle_rescan))
        .route("/treemap", get(handle_treemap))
        // SPEC-651 — MCP-parity routes (cover the surface `sentrux mcp` exposes)
        .route("/scan", post(handle_scan))
        .route("/evolution", get(handle_evolution))
        .route("/dsm", get(handle_dsm))
        .route("/test-gaps", get(handle_test_gaps))
        // Phase 2.1 — embedded web GUI. axum matches the literal JSON routes
        // above before the `/*path` wildcard, so this only ever serves the
        // SPA shell (`/`) and the hashed static assets.
        .route("/", get(crate::assets::handle_index))
        .route("/*path", get(crate::assets::handle_asset))
        .layer(tower_http::cors::CorsLayer::very_permissive())
        .with_state(shared.clone());

    let listener = tokio::net::TcpListener::bind(listen).await?;
    if crate::assets::gui_embedded() {
        eprintln!("[sentrux] serve listening on http://{} (web GUI at /)", listen);
    } else {
        eprintln!(
            "[sentrux] serve listening on http://{} (GUI not embedded — `cd web && npm run build` then rebuild)",
            listen
        );
    }

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    eprintln!("[sentrux] serve shut down cleanly");
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut sig) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            sig.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }
}

// --------------------------------------------------------------------------
// Shared state
// --------------------------------------------------------------------------

pub struct ServeState {
    pub cache: Arc<RwLock<HashMap<String, ScoreCacheEntry>>>,
    pub watch_dir: Option<PathBuf>,
    pub state_dir: PathBuf,
    pub disabled_flag_path: PathBuf,
}

impl ServeState {
    pub fn new(
        watch_dir: Option<String>,
        state_dir: Option<String>,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let state_dir = state_dir
            .map(PathBuf::from)
            .or_else(|| dirs::data_local_dir().map(|d| d.join("sentrux/state")))
            .ok_or("no state_dir and unable to resolve default")?;
        std::fs::create_dir_all(&state_dir)?;
        std::fs::create_dir_all(state_dir.join("baselines"))?;

        let watch_dir = watch_dir.map(PathBuf::from);
        let disabled_flag_path = std::env::var("SENTRUX_DISABLED_FLAG")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("/tmp/sentrux-disabled"));

        Ok(Self {
            cache: Arc::new(RwLock::new(HashMap::new())),
            watch_dir,
            state_dir,
            disabled_flag_path,
        })
    }
}

#[derive(Clone)]
pub struct ScoreCacheEntry {
    pub composite_score: i64,
    pub quality_signal: f64,
    pub modularity: f64,
    pub acyclicity: f64,
    pub depth: f64,
    pub equality: f64,
    pub redundancy: f64,
    pub cycle_count: usize,
    pub max_depth: u32,
    pub coupling_score: f64,
    pub god_file_count: usize,
    pub hotspot_count: usize,
    pub complex_fn_count: usize,
    pub treemap: serde_json::Value,
    pub scanned_at: chrono::DateTime<chrono::Utc>,
}

// --------------------------------------------------------------------------
// Scoring core (real sentrux-core invocation)
// --------------------------------------------------------------------------

fn cli_scan_limits() -> ScanLimits {
    let s = Settings::default();
    ScanLimits {
        max_file_size_kb: s.max_file_size_kb,
        max_parse_size_kb: s.max_parse_size_kb,
        max_call_targets: s.max_call_targets,
    }
}

/// Run a fresh scan + compute_health + compute_arch on `path`. Returns a cache
/// entry shaped for the SPEC-651 D4 schema. Errors when the path is unreadable
/// or scanning fails.
fn score_path(path: &Path) -> Result<ScoreCacheEntry, String> {
    let path_str = path
        .to_str()
        .ok_or_else(|| format!("non-UTF8 path: {}", path.display()))?;

    let limits = cli_scan_limits();
    let result = analysis::scanner::scan_directory(path_str, None, None, &limits, None)
        .map_err(|e| format!("scan failed: {}", e))?;

    let health = metrics::compute_health(&result.snapshot);
    let arch = metrics::arch::compute_arch(&result.snapshot);

    let scores = &health.root_cause_scores;
    let composite_score = (health.quality_signal * 100.0).round() as i64;

    // Treemap: per-file fan-out from god_files + most_unstable, condensed for the UI.
    let mut treemap_files: Vec<serde_json::Value> = Vec::new();
    for fm in &health.god_files {
        treemap_files.push(serde_json::json!({
            "path": fm.path,
            "size": fm.value,
            "kind": "god",
        }));
    }
    for fm in &health.hotspot_files {
        treemap_files.push(serde_json::json!({
            "path": fm.path,
            "size": fm.value,
            "kind": "hotspot",
        }));
    }
    let treemap = serde_json::json!({
        "files": treemap_files,
        "max_blast_file": arch.max_blast_file,
        "max_blast_radius": arch.max_blast_radius,
        "attack_surface_files": arch.attack_surface_files,
    });

    Ok(ScoreCacheEntry {
        composite_score,
        quality_signal: health.quality_signal,
        modularity: scores.modularity,
        acyclicity: scores.acyclicity,
        depth: scores.depth,
        equality: scores.equality,
        redundancy: scores.redundancy,
        cycle_count: health.circular_dep_count,
        max_depth: health.max_depth,
        coupling_score: health.coupling_score,
        god_file_count: health.god_files.len(),
        hotspot_count: health.hotspot_files.len(),
        complex_fn_count: health.complex_functions.len(),
        treemap,
        scanned_at: chrono::Utc::now(),
    })
}

// --------------------------------------------------------------------------
// Filesystem watcher
// --------------------------------------------------------------------------

fn spawn_watch_scorer(state: Arc<ServeState>, watch_dir: PathBuf) {
    tokio::spawn(async move {
        // Initial pass
        if let Ok(entries) = std::fs::read_dir(&watch_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let name = match path.file_name().and_then(|n| n.to_str()) {
                    Some(n) => n.to_string(),
                    None => continue,
                };
                match score_path(&path) {
                    Ok(entry) => {
                        state.cache.write().await.insert(name, entry);
                    }
                    Err(e) => eprintln!("[sentrux] initial scan of {} failed: {}", path.display(), e),
                }
            }
        }

        // notify-driven incremental updates
        let (tx, mut rx) = tokio::sync::mpsc::channel::<PathBuf>(64);
        let watch_dir_for_notify = watch_dir.clone();
        std::thread::spawn(move || {
            use notify::{recommended_watcher, RecursiveMode, Watcher};
            let (sync_tx, sync_rx) = std::sync::mpsc::channel();
            let mut watcher = match recommended_watcher(sync_tx) {
                Ok(w) => w,
                Err(e) => {
                    eprintln!("[sentrux] notify init failed: {}", e);
                    return;
                }
            };
            if let Err(e) = watcher.watch(&watch_dir_for_notify, RecursiveMode::Recursive) {
                eprintln!("[sentrux] notify watch failed: {}", e);
                return;
            }

            let mut pending: HashMap<String, std::time::Instant> = HashMap::new();
            const DEBOUNCE: std::time::Duration = std::time::Duration::from_millis(2000);

            loop {
                match sync_rx.recv_timeout(std::time::Duration::from_millis(250)) {
                    Ok(Ok(event)) => {
                        for path in event.paths {
                            if let Some(repo_name) =
                                repo_name_for_path(&watch_dir_for_notify, &path)
                            {
                                pending.insert(repo_name, std::time::Instant::now());
                            }
                        }
                    }
                    _ => {}
                }
                let now = std::time::Instant::now();
                let ready: Vec<String> = pending
                    .iter()
                    .filter(|(_, t)| now.duration_since(**t) >= DEBOUNCE)
                    .map(|(k, _)| k.clone())
                    .collect();
                for name in ready {
                    pending.remove(&name);
                    let path = watch_dir_for_notify.join(&name);
                    let _ = tx.blocking_send(path);
                }
            }
        });

        while let Some(path) = rx.recv().await {
            let name = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            match score_path(&path) {
                Ok(entry) => {
                    state.cache.write().await.insert(name, entry);
                }
                Err(e) => eprintln!("[sentrux] rescan of {} failed: {}", path.display(), e),
            }
        }
    });
}

fn repo_name_for_path(watch_dir: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(watch_dir).ok()?;
    let first = rel.components().next()?;
    Some(first.as_os_str().to_str()?.to_string())
}

// --------------------------------------------------------------------------
// Route handlers
// --------------------------------------------------------------------------

#[derive(Serialize)]
struct HealthBody {
    status: &'static str,
    version: String,
    repos_indexed: usize,
}

async fn handle_health(State(state): State<Arc<ServeState>>) -> impl IntoResponse {
    if state.disabled_flag_path.exists() {
        return error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "DISABLED",
            "operator-disabled",
        );
    }
    let count = state.cache.read().await.len();
    Json(HealthBody {
        status: "ok",
        version: format!("{}+serve.1", env!("CARGO_PKG_VERSION")),
        repos_indexed: count,
    })
    .into_response()
}

#[derive(Deserialize)]
struct RepoQuery {
    repo: Option<String>,
}

async fn handle_score(
    State(state): State<Arc<ServeState>>,
    Query(q): Query<RepoQuery>,
) -> impl IntoResponse {
    let repo = match q.repo {
        Some(r) => r,
        None => {
            return error_response(
                StatusCode::BAD_REQUEST,
                "MISSING_REPO",
                "repo query param required",
            );
        }
    };

    // Lazy-per-request scoring when no --watch dir was provided
    let entry_opt = state.cache.read().await.get(&repo).cloned();
    let entry = match entry_opt {
        Some(e) => e,
        None => match resolve_repo_path(&state, &repo) {
            Some(path) => match score_path(&path) {
                Ok(e) => {
                    state.cache.write().await.insert(repo.clone(), e.clone());
                    e
                }
                Err(err) => {
                    return error_response(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "SCORE_FAILED",
                        &err,
                    );
                }
            },
            None => {
                return error_response(
                    StatusCode::NOT_FOUND,
                    "REPO_NOT_INDEXED",
                    &format!("repo '{}' not indexed and not resolvable", repo),
                );
            }
        },
    };

    let baseline = read_baseline(&state, &repo).await.ok();
    let body = build_score_response(&repo, &entry, baseline.as_ref());
    Json(body).into_response()
}

async fn handle_get_baseline(
    State(state): State<Arc<ServeState>>,
    Query(q): Query<RepoQuery>,
) -> impl IntoResponse {
    let repo = match q.repo {
        Some(r) => r,
        None => {
            return error_response(StatusCode::BAD_REQUEST, "MISSING_REPO", "repo required");
        }
    };
    let baseline = read_baseline(&state, &repo).await.ok();
    let cache = state.cache.read().await;
    let current_score = cache.get(&repo).map(|e| e.composite_score);
    drop(cache);

    let delta = match (current_score, baseline.as_ref().map(|b| b.score)) {
        (Some(c), Some(b)) => Some(c - b),
        _ => None,
    };

    Json(serde_json::json!({
        "repo": repo,
        "baseline": baseline,
        "current_score": current_score,
        "delta": delta,
    }))
    .into_response()
}

#[derive(Deserialize)]
struct BaselineAction {
    action: String,
}

async fn handle_post_baseline(
    State(state): State<Arc<ServeState>>,
    Query(q): Query<RepoQuery>,
    Json(body): Json<BaselineAction>,
) -> impl IntoResponse {
    let repo = match q.repo {
        Some(r) => r,
        None => {
            return error_response(StatusCode::BAD_REQUEST, "MISSING_REPO", "repo required");
        }
    };
    match body.action.as_str() {
        "set" => {
            let cache = state.cache.read().await;
            let (score, indicators) = match cache.get(&repo) {
                Some(e) => (e.composite_score, Some(BaselineIndicators::from_cache(e))),
                None => {
                    return error_response(
                        StatusCode::NOT_FOUND,
                        "REPO_NOT_INDEXED",
                        "repo not indexed",
                    );
                }
            };
            drop(cache);
            let baseline = Baseline {
                score,
                set_at: chrono::Utc::now(),
                set_by: "api".to_string(),
                indicators,
            };
            if let Err(e) = write_baseline(&state, &repo, &baseline).await {
                return error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "WRITE_FAILED",
                    &e.to_string(),
                );
            }
            Json(serde_json::json!({"ok": true, "baseline": baseline})).into_response()
        }
        "reset" => {
            let path = baseline_path(&state, &repo);
            let _ = std::fs::remove_file(&path);
            Json(serde_json::json!({"ok": true, "reset": true})).into_response()
        }
        other => error_response(
            StatusCode::BAD_REQUEST,
            "BAD_ACTION",
            &format!("unknown action: {}", other),
        ),
    }
}

async fn handle_get_rules(
    State(state): State<Arc<ServeState>>,
    Query(q): Query<RepoQuery>,
) -> impl IntoResponse {
    let repo = match q.repo {
        Some(r) => r,
        None => {
            return error_response(StatusCode::BAD_REQUEST, "MISSING_REPO", "repo required");
        }
    };
    let path = match resolve_repo_path(&state, &repo) {
        Some(p) => p,
        None => {
            return error_response(
                StatusCode::NOT_FOUND,
                "REPO_PATH_UNRESOLVABLE",
                "no --watch dir and repo not in cache",
            );
        }
    };
    let config = match RulesConfig::try_load(&path) {
        Some(c) => c,
        None => {
            return Json(serde_json::json!({
                "repo": repo,
                "rules_loaded": false,
                "violations": [],
                "violation_count": 0,
                "message": "no .sentrux/rules.toml in repo",
            }))
            .into_response();
        }
    };

    // Scan + compute health/arch fresh for accurate violation reporting.
    let path_str = match path.to_str() {
        Some(s) => s,
        None => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "BAD_PATH",
                "non-UTF8 path",
            );
        }
    };
    let result =
        match analysis::scanner::scan_directory(path_str, None, None, &cli_scan_limits(), None) {
            Ok(r) => r,
            Err(e) => {
                return error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "SCAN_FAILED",
                    &e.to_string(),
                );
            }
        };
    let health = metrics::compute_health(&result.snapshot);
    let arch = metrics::arch::compute_arch(&result.snapshot);
    let check = check_rules(&config, &health, &arch, &result.snapshot.import_graph);

    let violations: Vec<serde_json::Value> = check
        .violations
        .iter()
        .map(|v| {
            serde_json::json!({
                "severity": format!("{:?}", v.severity).to_lowercase(),
                "rule": format!("{:?}", v.rule),
                "message": v.message,
                "files": v.files,
            })
        })
        .collect();

    Json(serde_json::json!({
        "repo": repo,
        "rules_loaded": true,
        "rules_checked": check.rules_checked,
        "violations": violations,
        "violation_count": check.violations.len(),
    }))
    .into_response()
}

async fn handle_rescan(
    State(state): State<Arc<ServeState>>,
    Query(q): Query<RepoQuery>,
) -> impl IntoResponse {
    let repo = match q.repo {
        Some(r) => r,
        None => {
            return error_response(StatusCode::BAD_REQUEST, "MISSING_REPO", "repo required");
        }
    };
    let path = match resolve_repo_path(&state, &repo) {
        Some(p) => p,
        None => {
            return error_response(
                StatusCode::PRECONDITION_FAILED,
                "REPO_UNRESOLVABLE",
                "rescan requires --watch dir or prior cache entry with known path",
            );
        }
    };
    if !path.is_dir() {
        return error_response(
            StatusCode::NOT_FOUND,
            "REPO_DIR_MISSING",
            &format!("{} is not a directory", path.display()),
        );
    }
    let entry = match score_path(&path) {
        Ok(e) => e,
        Err(err) => {
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, "SCORE_FAILED", &err);
        }
    };
    state.cache.write().await.insert(repo.clone(), entry);
    Json(serde_json::json!({
        "ok": true,
        "repo": repo,
        "rescanned_at": chrono::Utc::now(),
    }))
    .into_response()
}

async fn handle_treemap(
    State(state): State<Arc<ServeState>>,
    Query(q): Query<RepoQuery>,
) -> impl IntoResponse {
    let repo = match q.repo {
        Some(r) => r,
        None => {
            return error_response(StatusCode::BAD_REQUEST, "MISSING_REPO", "repo required");
        }
    };
    let cache = state.cache.read().await;
    let entry = match cache.get(&repo) {
        Some(e) => e.clone(),
        None => {
            return error_response(
                StatusCode::NOT_FOUND,
                "REPO_NOT_INDEXED",
                "repo not indexed",
            );
        }
    };
    drop(cache);
    Json(serde_json::json!({
        "repo": repo,
        "treemap": entry.treemap,
    }))
    .into_response()
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

fn resolve_repo_path(state: &ServeState, repo: &str) -> Option<PathBuf> {
    state.watch_dir.as_ref().map(|d| d.join(repo)).filter(|p| p.is_dir())
}

fn error_response(
    status: StatusCode,
    code: &str,
    message: &str,
) -> axum::response::Response {
    let body = serde_json::json!({
        "error": {
            "code": code,
            "message": message,
        }
    });
    (status, Json(body)).into_response()
}

#[derive(Clone, Serialize, Deserialize)]
struct Baseline {
    score: i64,
    set_at: chrono::DateTime<chrono::Utc>,
    set_by: String,
    /// The five root-cause indicator values at baseline-set time. Optional so
    /// older on-disk baselines (which only stored `score`) still deserialize;
    /// when present the GUI can draw a real "vs baseline" overlay on the radar.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    indicators: Option<BaselineIndicators>,
}

#[derive(Clone, Serialize, Deserialize)]
struct BaselineIndicators {
    modularity: f64,
    acyclicity: f64,
    depth: f64,
    equality: f64,
    redundancy: f64,
}

impl BaselineIndicators {
    fn from_cache(e: &ScoreCacheEntry) -> Self {
        Self {
            modularity: e.modularity,
            acyclicity: e.acyclicity,
            depth: e.depth,
            equality: e.equality,
            redundancy: e.redundancy,
        }
    }
}

fn baseline_path(state: &ServeState, repo: &str) -> PathBuf {
    state
        .state_dir
        .join("baselines")
        .join(format!("{}.json", repo))
}

async fn read_baseline(
    state: &ServeState,
    repo: &str,
) -> Result<Baseline, Box<dyn std::error::Error + Send + Sync>> {
    let path = baseline_path(state, repo);
    let text = tokio::fs::read_to_string(&path).await?;
    Ok(serde_json::from_str(&text)?)
}

async fn write_baseline(
    state: &ServeState,
    repo: &str,
    b: &Baseline,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let path = baseline_path(state, repo);
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(b)?;
    tokio::fs::write(&tmp, text).await?;
    tokio::fs::rename(&tmp, &path).await?;
    Ok(())
}

// --------------------------------------------------------------------------
// MCP-parity helpers: build_complexity_map + build_known_files
// (mirrored from sentrux-core::app::mcp_server::handlers_evo where they're
// pub(crate). Inlining here keeps upstream surface unchanged.)
// --------------------------------------------------------------------------

fn build_complexity_map(snapshot: &Snapshot) -> HashMap<String, u32> {
    let mut map = HashMap::new();
    collect_complexity(&snapshot.root, &mut map);
    map
}

fn extract_max_cc(node: &FileNode) -> Option<u32> {
    let funcs = node.sa.as_ref()?.functions.as_ref()?;
    Some(funcs.iter().filter_map(|f| f.cc).max().unwrap_or(1))
}

fn collect_complexity(node: &FileNode, map: &mut HashMap<String, u32>) {
    if !node.is_dir {
        if let Some(cc) = extract_max_cc(node) {
            map.insert(node.path.clone(), cc);
        }
    }
    if let Some(children) = &node.children {
        for child in children {
            collect_complexity(child, map);
        }
    }
}

fn build_known_files(snapshot: &Snapshot) -> std::collections::HashSet<String> {
    let mut set = std::collections::HashSet::new();
    collect_files(&snapshot.root, &mut set);
    set
}

fn collect_files(node: &FileNode, set: &mut std::collections::HashSet<String>) {
    if !node.is_dir {
        set.insert(node.path.clone());
    }
    if let Some(children) = &node.children {
        for child in children {
            collect_files(child, set);
        }
    }
}

// --------------------------------------------------------------------------
// MCP-parity routes
// --------------------------------------------------------------------------

#[derive(Deserialize)]
struct ScanBody {
    path: String,
    #[serde(default)]
    repo_name: Option<String>,
}

/// `POST /scan` — explicit scan-and-cache for callers without --watch.
/// Body: `{path: "<absolute_path>", repo_name: "<optional_alias>"}`.
/// Returns the same payload shape as `/score` after caching.
async fn handle_scan(
    State(state): State<Arc<ServeState>>,
    Json(body): Json<ScanBody>,
) -> impl IntoResponse {
    let path = PathBuf::from(&body.path);
    if !path.is_dir() {
        return error_response(
            StatusCode::BAD_REQUEST,
            "BAD_PATH",
            &format!("path is not a directory: {}", body.path),
        );
    }
    let repo = body
        .repo_name
        .or_else(|| {
            path.file_name()
                .and_then(|n| n.to_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "anon".to_string());
    let entry = match score_path(&path) {
        Ok(e) => e,
        Err(err) => {
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, "SCORE_FAILED", &err);
        }
    };
    state.cache.write().await.insert(repo.clone(), entry.clone());
    let baseline = read_baseline(&state, &repo).await.ok();
    Json(build_score_response(&repo, &entry, baseline.as_ref())).into_response()
}

#[derive(Deserialize)]
struct EvolutionQuery {
    repo: Option<String>,
    days: Option<u32>,
}

/// `GET /evolution?repo=<name>&days=<N>` — MCP `git_stats` equivalent.
/// Returns churn, hotspots, single-author ratio, coupling pairs.
async fn handle_evolution(
    State(state): State<Arc<ServeState>>,
    Query(q): Query<EvolutionQuery>,
) -> impl IntoResponse {
    let repo = match q.repo {
        Some(r) => r,
        None => {
            return error_response(StatusCode::BAD_REQUEST, "MISSING_REPO", "repo required");
        }
    };
    let path = match resolve_repo_path(&state, &repo) {
        Some(p) => p,
        None => {
            return error_response(
                StatusCode::NOT_FOUND,
                "REPO_PATH_UNRESOLVABLE",
                "no --watch dir and repo not previously scanned",
            );
        }
    };
    let path_str = match path.to_str() {
        Some(s) => s,
        None => {
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, "BAD_PATH", "non-UTF8 path");
        }
    };
    let result =
        match analysis::scanner::scan_directory(path_str, None, None, &cli_scan_limits(), None) {
            Ok(r) => r,
            Err(e) => {
                return error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "SCAN_FAILED",
                    &e.to_string(),
                );
            }
        };
    let snapshot = result.snapshot;
    let known = build_known_files(&snapshot);
    let complexity = build_complexity_map(&snapshot);

    let report =
        match metrics::evo::compute_evolution(&path, &known, &complexity, q.days) {
            Ok(r) => r,
            Err(e) => {
                return error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "EVOLUTION_FAILED",
                    &format!("evolution analysis failed: {}", e),
                );
            }
        };

    Json(serde_json::json!({
        "repo": repo,
        "lookback_days": report.lookback_days,
        "commits_analyzed": report.commits_analyzed,
        "files_with_churn": report.churn.len(),
        "single_author_ratio": report.single_author_ratio,
        "coupling_pairs_found": report.coupling_pairs.len(),
        "hotspot_count": report.hotspots.len(),
        "bus_factor_solo_files":
            (report.single_author_ratio * report.churn.len() as f64).round() as u32,
        "top_hotspots": report.hotspots.iter().take(10).map(|h| serde_json::json!({
            "file": h.file,
            "risk_score": h.risk_score,
            "churn": h.churn_count,
            "complexity": h.max_complexity,
        })).collect::<Vec<_>>(),
    }))
    .into_response()
}

#[derive(Deserialize)]
struct DsmQuery {
    repo: Option<String>,
    format: Option<String>,
}

/// `GET /dsm?repo=<name>&format=text|stats` — MCP `dsm` equivalent.
async fn handle_dsm(
    State(state): State<Arc<ServeState>>,
    Query(q): Query<DsmQuery>,
) -> impl IntoResponse {
    let repo = match q.repo {
        Some(r) => r,
        None => {
            return error_response(StatusCode::BAD_REQUEST, "MISSING_REPO", "repo required");
        }
    };
    let path = match resolve_repo_path(&state, &repo) {
        Some(p) => p,
        None => {
            return error_response(
                StatusCode::NOT_FOUND,
                "REPO_PATH_UNRESOLVABLE",
                "no --watch dir and repo not previously scanned",
            );
        }
    };
    let path_str = match path.to_str() {
        Some(s) => s,
        None => {
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, "BAD_PATH", "non-UTF8 path");
        }
    };
    let result =
        match analysis::scanner::scan_directory(path_str, None, None, &cli_scan_limits(), None) {
            Ok(r) => r,
            Err(e) => {
                return error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "SCAN_FAILED",
                    &e.to_string(),
                );
            }
        };
    let dsm = metrics::dsm::build_dsm(&result.snapshot.import_graph);
    let stats = metrics::dsm::compute_stats(&dsm);

    let mut body = serde_json::json!({
        "repo": repo,
        "size": stats.size,
        "edge_count": stats.edge_count,
        "density": stats.density,
        "above_diagonal": stats.above_diagonal,
        "below_diagonal": stats.below_diagonal,
        "same_level": stats.same_level,
        "propagation_cost": stats.propagation_cost,
        "level_breaks": dsm.level_breaks.len(),
        "interpretation": if stats.above_diagonal == 0 {
            "Clean layering: all dependencies flow downward"
        } else if stats.above_diagonal as f64 / stats.edge_count.max(1) as f64 > 0.2 {
            "Significant architectural inversions detected"
        } else {
            "Mostly clean layering with minor inversions"
        },
        "clusters": stats.clusters.iter().take(5).map(|c| serde_json::json!({
            "level": c.level,
            "files_count": c.files.len(),
            "internal_edges": c.internal_edges,
        })).collect::<Vec<_>>(),
    });
    if q.format.as_deref() == Some("text") {
        body["matrix"] = serde_json::json!(metrics::dsm::render_text(&dsm, 30));
    }
    Json(body).into_response()
}

#[derive(Deserialize)]
struct TestGapsQuery {
    repo: Option<String>,
    limit: Option<usize>,
}

/// `GET /test-gaps?repo=<name>&limit=<N>` — MCP `test_gaps` equivalent.
async fn handle_test_gaps(
    State(state): State<Arc<ServeState>>,
    Query(q): Query<TestGapsQuery>,
) -> impl IntoResponse {
    let repo = match q.repo {
        Some(r) => r,
        None => {
            return error_response(StatusCode::BAD_REQUEST, "MISSING_REPO", "repo required");
        }
    };
    let path = match resolve_repo_path(&state, &repo) {
        Some(p) => p,
        None => {
            return error_response(
                StatusCode::NOT_FOUND,
                "REPO_PATH_UNRESOLVABLE",
                "no --watch dir and repo not previously scanned",
            );
        }
    };
    let path_str = match path.to_str() {
        Some(s) => s,
        None => {
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, "BAD_PATH", "non-UTF8 path");
        }
    };
    let result =
        match analysis::scanner::scan_directory(path_str, None, None, &cli_scan_limits(), None) {
            Ok(r) => r,
            Err(e) => {
                return error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "SCAN_FAILED",
                    &e.to_string(),
                );
            }
        };
    let complexity = build_complexity_map(&result.snapshot);
    let report = metrics::testgap::compute_test_gaps(&result.snapshot, &complexity);
    let limit = q.limit.unwrap_or(20);

    Json(serde_json::json!({
        "repo": repo,
        "coverage_score": report.coverage_score,
        "source_files": report.source_files,
        "test_files": report.test_files,
        "tested": report.tested_source_files,
        "untested": report.untested_source_files,
        "coverage_ratio": report.coverage_ratio,
        "riskiest_untested": report.gaps.iter().take(limit).map(|g| serde_json::json!({
            "file": g.file,
            "risk_score": g.risk_score,
            "complexity": g.max_complexity,
            "fan_in": g.fan_in,
            "lang": g.lang,
        })).collect::<Vec<_>>(),
    }))
    .into_response()
}

fn build_score_response(
    repo: &str,
    entry: &ScoreCacheEntry,
    baseline: Option<&Baseline>,
) -> serde_json::Value {
    let delta = baseline.map(|b| entry.composite_score - b.score);
    serde_json::json!({
        "repo": repo,
        "score": entry.composite_score,
        "score_normalized": entry.quality_signal,
        "indicators": {
            "modularity":  {"value": entry.modularity,  "weight": 0.20, "contribution": entry.modularity * 20.0},
            "acyclicity":  {"value": entry.acyclicity,  "weight": 0.20, "contribution": entry.acyclicity * 20.0},
            "depth":       {"value": entry.depth,       "weight": 0.20, "contribution": entry.depth * 20.0},
            "equality":    {"value": entry.equality,    "weight": 0.20, "contribution": entry.equality * 20.0},
            "redundancy":  {"value": entry.redundancy,  "weight": 0.20, "contribution": entry.redundancy * 20.0},
        },
        "diagnostics": {
            "cycle_count": entry.cycle_count,
            "max_depth": entry.max_depth,
            "coupling_score": entry.coupling_score,
            "god_file_count": entry.god_file_count,
            "hotspot_count": entry.hotspot_count,
            "complex_fn_count": entry.complex_fn_count,
        },
        "baseline": baseline,
        "delta": delta,
        "scanned_at": entry.scanned_at,
        "source": format!("sentrux {}+serve.1", env!("CARGO_PKG_VERSION")),
    })
}
