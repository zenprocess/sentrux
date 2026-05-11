//! Phase 2.1 — the web GUI, baked into the binary.
//!
//! `web/dist/` (the Vite production build) is embedded at compile time via
//! [`rust_embed`]. `sentrux serve` mounts this so that
//! `http://<listen>/` returns the SPA shell and `/<asset>` returns the
//! hashed JS/CSS/SVG bundles, with no files needed on disk.
//!
//! Build flow (two steps):
//! ```text
//! cd web && npm install && npm run build   # → web/dist/
//! cargo build --release                    # embeds web/dist/ into the binary
//! ```
//! `web/dist/` is committed to the repo (see `web/.gitignore`), so a plain
//! `cargo build` from a fresh checkout already produces a working GUI; the
//! first step is only needed after editing anything under `web/src/`.
//!
//! SPA routing: any path that does not match an embedded asset and does not
//! look like a file request (no `.` in the last segment) falls back to
//! `index.html`, so client-side routes deep-link correctly.

use axum::{
    body::Body,
    extract::Path as AxumPath,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "$CARGO_MANIFEST_DIR/../web/dist"]
struct WebAssets;

/// True when the embedded build is non-empty (i.e. `web/dist/index.html`
/// exists). Used to decide whether to advertise the GUI in `/health`-ish
/// places; the daemon still mounts the routes either way (they 404 cleanly).
pub fn gui_embedded() -> bool {
    WebAssets::get("index.html").is_some()
}

fn serve_embedded(path: &str) -> Option<Response> {
    let file = WebAssets::get(path)?;
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let body = Body::from(file.data.into_owned());
    Some(
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime.as_ref())
            .header(header::CACHE_CONTROL, cache_control_for(path))
            .body(body)
            .expect("static response builds"),
    )
}

fn cache_control_for(path: &str) -> &'static str {
    // Vite emits content-hashed asset filenames under assets/ — safe to cache
    // hard. index.html (and anything else) must revalidate.
    if path.starts_with("assets/") {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    }
}

fn index_html() -> Response {
    match WebAssets::get("index.html") {
        Some(f) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .header(header::CACHE_CONTROL, "no-cache")
            .body(Body::from(f.data.into_owned()))
            .expect("index response builds"),
        None => (
            StatusCode::NOT_FOUND,
            "sentrux: web GUI not embedded — run `cd web && npm run build` then rebuild the binary",
        )
            .into_response(),
    }
}

/// `GET /` — the SPA shell.
pub async fn handle_index() -> Response {
    index_html()
}

/// `GET /*path` catch-all — embedded asset, or SPA fallback to index.html.
///
/// Registered after the JSON API routes so axum never lets it shadow them.
pub async fn handle_asset(AxumPath(path): AxumPath<String>) -> Response {
    let rel = path.trim_start_matches('/');

    if rel.is_empty() {
        return index_html();
    }
    if let Some(resp) = serve_embedded(rel) {
        return resp;
    }
    // Looks like a real file (has an extension in the last segment) but wasn't
    // found → genuine 404. Otherwise treat as a client-side route → index.html.
    let last = rel.rsplit('/').next().unwrap_or(rel);
    if last.contains('.') {
        return (StatusCode::NOT_FOUND, format!("not found: /{rel}")).into_response();
    }
    index_html()
}
