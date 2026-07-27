// Getting the backend and the browser runtime to actually find each other.
//
// "Browser automation says runtime offline. How am I intended to run browser automation with
//  Playwright or something similar from the server? We need to make this be able to work."
//
// It runs as its own service, because Chromium and the backend together OOM-killed a 512MB
// instance. That means two things have to be right that nobody will ever look at again: the
// URL the backend builds, and the token it presents. Both are the kind of thing that fails
// silently and reports "offline" — which is exactly how this item spent a month.
//
// The URL matters because Render's `fromService` hands over a HOSTNAME, not a URL. There is
// no blueprint property that includes the scheme. So the backend infers it, and if that
// inference is ever wrong the feature is dead with a message that blames the runtime.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// web.mjs pulls in the store transitively, and the store refuses to open live data from a
// test process. Nothing here touches it — this just satisfies the guard with a throwaway dir.
process.env.HOMEOPS_DATA_DIR ??= mkdtempSync(join(tmpdir(), "familios-browser-wiring-"));

async function withEnv(vars, fn) {
  const prev = { ...process.env };
  Object.assign(process.env, vars);
  try {
    // Fresh import each time: the module reads env at call time, but the cache-buster keeps
    // this honest if that ever changes.
    const mod = await import(`../web.mjs?t=${encodeURIComponent(JSON.stringify(vars))}`);
    return await fn(mod);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in prev)) delete process.env[k];
    Object.assign(process.env, prev);
  }
}

test("THE RENDER CASE: a bare hostname becomes an https URL", async () => {
  // This is literally what `fromService: {property: host}` yields. Left alone it fails the
  // /^https?:/ check and the backend concludes there is no runtime at all.
  await withEnv({ BROWSER_RUNTIME_URL: "familios-browser-runtime.onrender.com" }, (m) => {
    assert.equal(m.browserRuntimeBase(), "https://familios-browser-runtime.onrender.com");
  });
});

test("the documented local runtime is http, not https", async () => {
  // `localhost:9223` over https would fail the TLS handshake and look like the runtime is down.
  await withEnv({ BROWSER_RUNTIME_URL: "localhost:9223" }, (m) => {
    assert.equal(m.browserRuntimeBase(), "http://localhost:9223");
  });
  await withEnv({ BROWSER_RUNTIME_URL: "127.0.0.1:9223" }, (m) => {
    assert.equal(m.browserRuntimeBase(), "http://127.0.0.1:9223");
  });
});

test("an explicit scheme is never second-guessed", async () => {
  await withEnv({ BROWSER_RUNTIME_URL: "http://box.local:9223/" }, (m) => {
    assert.equal(m.browserRuntimeBase(), "http://box.local:9223", "trailing slash trimmed, scheme kept");
  });
  await withEnv({ BROWSER_RUNTIME_URL: "https://runtime.example.com" }, (m) => {
    assert.equal(m.browserRuntimeBase(), "https://runtime.example.com");
  });
});

test("a websocket URL is passed through unchanged so the caller can refuse it by name", async () => {
  // Silently rewriting ws:// to https:// would produce a confusing connection error instead
  // of "set BROWSER_RUNTIME_URL to the HTTP runtime".
  await withEnv({ BROWSER_RUNTIME_URL: "wss://chrome.example.com" }, (m) => {
    assert.equal(m.browserRuntimeBase(), "wss://chrome.example.com");
  });
});

test("no runtime configured is an empty string, not a URL to nowhere", async () => {
  await withEnv({ BROWSER_RUNTIME_URL: "" }, (m) => assert.equal(m.browserRuntimeBase(), ""));
  await withEnv({ BROWSER_RUNTIME_URL: "   " }, (m) => assert.equal(m.browserRuntimeBase(), ""));
});

test("the token is sent as a bearer, and omitted entirely when there isn't one", async () => {
  // Omitted rather than empty: the runtime binds loopback-only without a token, and an
  // `authorization: Bearer ` header on a local call is noise that looks like a bug.
  await withEnv({ BROWSER_RUNTIME_TOKEN: "s3cret" }, (m) => {
    assert.deepEqual(m.runtimeAuthHeader(), { authorization: "Bearer s3cret" });
  });
  await withEnv({ BROWSER_RUNTIME_TOKEN: "" }, (m) => {
    assert.deepEqual(m.runtimeAuthHeader(), {});
  });
});

test("the runtime refuses to expose a browser it cannot authenticate", async () => {
  // The security property that makes a PUBLIC runtime service safe: you cannot reach a
  // configuration that is both reachable from the internet and unauthenticated. Asserted on
  // the source because starting it requires Playwright's Chromium, which CI does not install.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../browser-runtime/index.mjs", import.meta.url), "utf8");
  assert.match(src, /const HOST = TOKEN \? "0\.0\.0\.0" : "127\.0\.0\.1"/,
    "no token must mean loopback — forgetting the token cannot be what exposes it");
  assert.match(src, /timingSafeEqual/, "token comparison must not leak length or content by timing");
  assert.match(src, /server\.listen\(PORT, HOST,/, "the bind address has to actually be used");
});

test("the health endpoint stays open, because a platform health check cannot hold a token", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../browser-runtime/index.mjs", import.meta.url), "utf8");
  const getLine = src.indexOf('if (req.method === "GET")');
  const gate = src.indexOf("if (!tokenOk(req))");
  assert.ok(getLine > 0 && gate > getLine,
    "the GET health response must come BEFORE the token gate, or Render marks the service unhealthy and never routes to it");
});
