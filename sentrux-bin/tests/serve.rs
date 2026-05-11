//! Integration tests for `sentrux serve` HTTP daemon (SPEC-651 US-C).
//!
//! Spawns the released binary in `--watch` mode against a fixture repo,
//! waits for the cache to warm up, hits each route via reqwest-style
//! curl, and asserts the contract argus + zendev-lite skills depend on.

use std::process::{Child, Command, Stdio};
use std::thread::sleep;
use std::time::{Duration, Instant};

const PORT: u16 = 18103; // off the default to avoid collisions with a running daemon

struct Daemon {
    child: Child,
    _state_dir: tempfile::TempDir,
    _watch_dir: tempfile::TempDir,
}

impl Daemon {
    fn spawn(watch_dir: &std::path::Path) -> Self {
        let state_dir = tempfile::tempdir().expect("state tmpdir");
        let _watch_dir = tempfile::TempDir::new().unwrap(); // unused holder, real dir passed in

        let bin = env!("CARGO_BIN_EXE_sentrux");
        let child = Command::new(bin)
            .args([
                "serve",
                "--listen",
                &format!("127.0.0.1:{}", PORT),
                "--watch",
                watch_dir.to_str().unwrap(),
                "--state-dir",
                state_dir.path().to_str().unwrap(),
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn sentrux serve");

        // Poll /health until it answers
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            if Instant::now() > deadline {
                panic!("sentrux serve did not become healthy within 15s");
            }
            if let Ok(resp) = ureq::get(&format!("http://127.0.0.1:{}/health", PORT)).call() {
                if resp.status() == 200 {
                    break;
                }
            }
            sleep(Duration::from_millis(200));
        }

        Self {
            child,
            _state_dir: state_dir,
            _watch_dir,
        }
    }

    fn wait_for_repos(&self, want: usize, timeout_s: u64) {
        let deadline = Instant::now() + Duration::from_secs(timeout_s);
        loop {
            if Instant::now() > deadline {
                panic!("repos_indexed never reached {} within {}s", want, timeout_s);
            }
            if let Ok(resp) = ureq::get(&format!("http://127.0.0.1:{}/health", PORT)).call() {
                if let Ok(body) = resp.into_string() {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&body) {
                        if v["repos_indexed"].as_u64().unwrap_or(0) >= want as u64 {
                            return;
                        }
                    }
                }
            }
            sleep(Duration::from_millis(300));
        }
    }
}

impl Drop for Daemon {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn make_fixture_repo() -> tempfile::TempDir {
    let watch = tempfile::tempdir().expect("watch tmpdir");
    let repo = watch.path().join("demo");
    std::fs::create_dir_all(&repo).unwrap();
    std::fs::write(
        repo.join("a.py"),
        "from b import f\n\ndef g():\n    return f() + 1\n",
    )
    .unwrap();
    std::fs::write(
        repo.join("b.py"),
        "def f():\n    return 42\n",
    )
    .unwrap();
    watch
}

#[test]
#[ignore = "requires release binary; run with `cargo test --release -- --ignored`"]
fn health_returns_status_ok() {
    let watch = make_fixture_repo();
    let _daemon = Daemon::spawn(watch.path());

    let resp = ureq::get(&format!("http://127.0.0.1:{}/health", PORT))
        .call()
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.into_json().unwrap();
    assert_eq!(body["status"], "ok");
    assert!(body["version"].as_str().unwrap().contains("+serve."));
}

#[test]
#[ignore = "requires release binary; run with `cargo test --release -- --ignored`"]
fn score_returns_5_indicators_for_watched_repo() {
    let watch = make_fixture_repo();
    let daemon = Daemon::spawn(watch.path());
    daemon.wait_for_repos(1, 10);

    let resp = ureq::get(&format!("http://127.0.0.1:{}/score?repo=demo", PORT))
        .call()
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.into_json().unwrap();
    assert_eq!(body["repo"], "demo");
    assert!(body["score"].as_i64().unwrap() >= 0);
    assert!(body["score"].as_i64().unwrap() <= 100);

    for indicator in &["modularity", "acyclicity", "depth", "equality", "redundancy"] {
        let v = &body["indicators"][indicator]["value"];
        assert!(
            v.is_number(),
            "indicator {} should be numeric, got {:?}",
            indicator,
            v
        );
    }
}

#[test]
#[ignore = "requires release binary; run with `cargo test --release -- --ignored`"]
fn baseline_round_trip_yields_zero_delta() {
    let watch = make_fixture_repo();
    let daemon = Daemon::spawn(watch.path());
    daemon.wait_for_repos(1, 10);

    let set_resp = ureq::post(&format!("http://127.0.0.1:{}/baseline?repo=demo", PORT))
        .set("Content-Type", "application/json")
        .send_string(r#"{"action":"set"}"#)
        .unwrap();
    assert_eq!(set_resp.status(), 200);

    let get_resp = ureq::get(&format!("http://127.0.0.1:{}/baseline?repo=demo", PORT))
        .call()
        .unwrap();
    let body: serde_json::Value = get_resp.into_json().unwrap();
    assert_eq!(body["delta"].as_i64(), Some(0));
    assert_eq!(body["repo"], "demo");
}

#[test]
#[ignore = "requires release binary; run with `cargo test --release -- --ignored`"]
fn unknown_repo_yields_404() {
    let watch = make_fixture_repo();
    let _daemon = Daemon::spawn(watch.path());

    let resp = ureq::get(&format!("http://127.0.0.1:{}/score?repo=nonexistent", PORT))
        .call();
    let err = resp.unwrap_err();
    let resp = match err {
        ureq::Error::Status(code, response) => {
            assert_eq!(code, 404);
            response
        }
        ureq::Error::Transport(t) => panic!("transport error: {}", t),
    };
    let body: serde_json::Value = resp.into_json().unwrap();
    assert_eq!(body["error"]["code"], "REPO_NOT_INDEXED");
}

#[test]
#[ignore = "requires release binary; run with `cargo test --release -- --ignored`"]
fn rules_endpoint_handles_missing_rules_toml() {
    let watch = make_fixture_repo();
    let daemon = Daemon::spawn(watch.path());
    daemon.wait_for_repos(1, 10);

    let resp = ureq::get(&format!("http://127.0.0.1:{}/rules?repo=demo", PORT))
        .call()
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.into_json().unwrap();
    assert_eq!(body["rules_loaded"], false);
    assert_eq!(body["violation_count"], 0);
}

// --- Phase 2.1 — embedded web GUI ----------------------------------------

#[test]
#[ignore = "requires release binary; run with `cargo test --release -- --ignored`"]
fn root_serves_embedded_spa_shell() {
    let watch = make_fixture_repo();
    let _daemon = Daemon::spawn(watch.path());

    let resp = ureq::get(&format!("http://127.0.0.1:{}/", PORT))
        .call()
        .unwrap();
    assert_eq!(resp.status(), 200);
    assert!(
        resp.header("content-type")
            .unwrap_or_default()
            .contains("text/html"),
        "/ should be served as html"
    );
    let body = resp.into_string().unwrap();
    assert!(body.contains("<div id=\"root\">"), "SPA shell mounts #root");
}

#[test]
#[ignore = "requires release binary; run with `cargo test --release -- --ignored`"]
fn unknown_client_route_falls_back_to_index() {
    let watch = make_fixture_repo();
    let _daemon = Daemon::spawn(watch.path());

    // A path with no file extension is treated as a client-side route → index.html.
    let resp = ureq::get(&format!("http://127.0.0.1:{}/some/deep/link", PORT))
        .call()
        .unwrap();
    assert_eq!(resp.status(), 200);
    assert!(resp
        .header("content-type")
        .unwrap_or_default()
        .contains("text/html"));

    // A path that looks like a missing static file is a genuine 404.
    let err = ureq::get(&format!("http://127.0.0.1:{}/nope.js", PORT))
        .call()
        .unwrap_err();
    match err {
        ureq::Error::Status(code, _) => assert_eq!(code, 404),
        ureq::Error::Transport(t) => panic!("transport error: {}", t),
    }
}

#[test]
#[ignore = "requires release binary; run with `cargo test --release -- --ignored`"]
fn baseline_persists_indicator_values() {
    let watch = make_fixture_repo();
    let daemon = Daemon::spawn(watch.path());
    daemon.wait_for_repos(1, 10);

    let set_resp = ureq::post(&format!("http://127.0.0.1:{}/baseline?repo=demo", PORT))
        .set("Content-Type", "application/json")
        .send_string(r#"{"action":"set"}"#)
        .unwrap();
    assert_eq!(set_resp.status(), 200);
    let set_body: serde_json::Value = set_resp.into_json().unwrap();
    for indicator in &["modularity", "acyclicity", "depth", "equality", "redundancy"] {
        assert!(
            set_body["baseline"]["indicators"][indicator].is_number(),
            "baseline should persist {} value",
            indicator
        );
    }

    // /score should surface the persisted per-indicator baseline so the GUI
    // can draw a "vs baseline" overlay.
    let score_resp = ureq::get(&format!("http://127.0.0.1:{}/score?repo=demo", PORT))
        .call()
        .unwrap();
    let score_body: serde_json::Value = score_resp.into_json().unwrap();
    assert!(score_body["baseline"]["indicators"]["modularity"].is_number());
}
