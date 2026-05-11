//! Sentrux binary library — allows sentrux-pro to reuse the entire CLI/GUI.
//!
//! Architecture: sentrux-pro depends on sentrux_bin and calls `sentrux_bin::run()`.
//! The only difference: sentrux-pro calls `license::set_tier(Pro)` before `run()`.

mod main_impl;
pub use main_impl::run;

// SPEC-651 — `sentrux serve` axum HTTP daemon. Module is public so
// downstream API consumers running the binary directly can link against the
// same surface.
pub mod serve;

// Phase 2.1 — the web GUI (web/dist/) embedded into the binary and served
// by `sentrux serve` at `/`.
pub mod assets;
