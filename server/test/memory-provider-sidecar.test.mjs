// WP-007 s2 — integration test against a LIVE local Supermemory sidecar.
//
// This test genuinely ATTEMPTS to boot a real sidecar via the standalone launcher
// (server/scripts/memory-sidecar-launcher.mjs) — it does not mock or assume success. If the
// binary genuinely cannot run on this host, the test SKIPS with the launcher's real reason
// (`t.skip(reason)`), which is itself the DEC-014 trigger: the run log documents exactly why
// the sidecar path was abandoned in favor of the sqlite-FTS5 fallback, instead of silently
// passing or faking a green integration test. See server/memory-provider.mjs's header for
// the full narrative.
//
// If a sidecar DOES come up (e.g. this suite runs later on a host with WSL installed), the
// test exercises search latency (n>=20 queries, p50/p95) against it and reports the numbers
// — that's the "measure and report" requirement for a real sidecar, done for real rather
// than assumed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { startSidecar, stopSidecar } from "../scripts/memory-sidecar-launcher.mjs";
import { createMemoryProvider } from "../memory-provider.mjs";

test("live sidecar integration (skips with the real reason if the binary cannot run here)", async (t) => {
  const boot = await startSidecar({ port: 6768, timeoutMs: 25_000 });
  if (!boot.ok) {
    t.skip(`DEC-014 fallback trigger — sidecar could not start on this host: ${boot.reason}`);
    return;
  }
  t.after(() => stopSidecar(boot.proc));

  const mp = createMemoryProvider({ dataDir: fs.mkdtempSync(join(os.tmpdir(), "homeops-sidecar-it-")), sidecarEnabled: true, sidecarUrl: `http://127.0.0.1:${boot.port}` });
  const containerTag = "sidecar-it-hh1";
  for (let i = 0; i < 25; i++) {
    const r = await mp.add(`Fixture memory number ${i}: the family does thing ${i} on day ${i % 7}`, { containerTag });
    assert.equal(r.ok, true, `seed add #${i} should succeed against a live sidecar`);
  }

  const N = 20;
  const latencies = [];
  for (let i = 0; i < N; i++) {
    const t0 = Date.now();
    const r = await mp.search(`thing ${i % 7}`, { containerTag });
    latencies.push(Date.now() - t0);
    assert.equal(r.ok, true);
  }
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(N * 0.5)];
  const p95 = latencies[Math.floor(N * 0.95)];
  // eslint-disable-next-line no-console
  console.log(`[memory-provider sidecar] search latency over ${N} queries: p50=${p50}ms p95=${p95}ms`);
  assert.ok(p95 < 300, `PRD §14 budget: search p95 must be < 300ms, measured ${p95}ms`);
});
