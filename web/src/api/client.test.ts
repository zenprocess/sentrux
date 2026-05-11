import { afterEach, describe, expect, it, vi } from "vitest";
import { DaemonClient } from "./client";
import { SAMPLE_SCORE } from "../test/fixtures";

function mockFetchOnce(body: unknown, init?: { status?: number }): void {
  const status = init?.status ?? 200;
  const res = new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));
}

describe("DaemonClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("builds /score URL with repo param against the configured base", async () => {
    mockFetchOnce(SAMPLE_SCORE);
    const client = new DaemonClient("http://daemon.local:8103");
    const out = await client.score("/x/y");
    expect(out.score).toBe(40);
    const call = vi.mocked(fetch).mock.calls[0];
    expect(call).toBeDefined();
    if (call) {
      expect(String(call[0])).toBe(
        "http://daemon.local:8103/score?repo=%2Fx%2Fy",
      );
    }
  });

  it("strips a trailing slash from the base", () => {
    const c = new DaemonClient("http://daemon.local:8103/");
    expect(c.base).toBe("http://daemon.local:8103");
  });

  it("supports an empty base for same-origin deployments", () => {
    const c = new DaemonClient("");
    expect(c.base).toBe("");
  });

  it("raises an Error with the daemon's error.message on 4xx", async () => {
    mockFetchOnce(
      { error: { code: "REPO_NOT_INDEXED", message: "not indexed" } },
      { status: 400 },
    );
    const client = new DaemonClient("http://daemon.local:8103");
    await expect(client.score("/missing")).rejects.toThrow(/not indexed/);
  });
});
