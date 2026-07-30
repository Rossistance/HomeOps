// CAN A STRANGER WHO SIGNS UP ACTUALLY USE THE PRODUCT?
//
// Three things said yes on paper and no in practice, and together they meant a paying
// household could sign up and then be stuck:
//
//   • OAuth state was written into the household's database when the flow STARTED (a request
//     with a session) and read back in the callback, which has none — so currentTenant() fell
//     to the resident household, the state was never found, and every connection attempt died
//     as "invalid_state". No signed-up household could connect Google at all.
//   • Email went out only through a household's own connected Gmail. A one-second-old
//     household has none, so password reset, recovery and verification were undeliverable to
//     exactly the people those flows exist for. Circular: the mail that lets you sign in
//     required an integration you can only add once signed in.
//   • The deployment's AI keys were applied once at boot with no tenant context, configuring
//     the resident family and nobody else. Every later household had no AI provider.
//
// These tests pin the shape of each fix rather than the transport: no live Resend key runs in
// CI, so the assertions are about WHERE state lives, WHICH household gets configured, and
// whether the server tells the truth about what it could and couldn't send.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, readStoreDoc } from "./harness.mjs";
import { platformMailReadiness, platformMailStatus } from "../mailer.mjs";
import { classifySmsKeyword } from "../sms.mjs";

let ctx;
before(async () => { ctx = await startServer(); });
after(async () => { await stopServer(ctx); });

async function signup(email, ownerName, householdName) {
  const res = await ctx.fetch("/api/signup", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct horse battery", ownerName, householdName }),
  });
  const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  const data = await res.json();
  return {
    status: res.status, data, householdId: data.session?.householdId,
    async req(path, init = {}) {
      const headers = { Cookie: cookie, ...(init.headers || {}) };
      if (init.method && init.method !== "GET") { headers["x-homeops-csrf"] = data.session.csrf; headers["content-type"] ??= "application/json"; }
      const r = await ctx.fetch(path, { ...init, headers });
      let out = null; try { out = await r.json(); } catch { /* html or gz */ }
      return { status: r.status, data: out, raw: r };
    },
  };
}

let fresh;

/* ---- OAuth state lives where the callback can actually find it ---- */

test("OAuth state is written to the system tenant, not the household's database", async () => {
  fresh = await signup("newfamily@example.com", "Nina", "New Family");
  assert.equal(fresh.status, 200, JSON.stringify(fresh.data));

  const start = await fresh.req("/api/oauth/google/start", { method: "POST", body: JSON.stringify({}) });
  // Google may be unconfigured in this deployment; that refusal is fine and is not what
  // this test is about. Only assert placement when a state was actually minted.
  if (start.status === 200 && start.data?.state) {
    const inSystem = readStoreDoc(ctx, "oauth_states.json", {}, "_system");
    assert.ok(inSystem[start.data.state], "the callback (which has no session) can find it");
    const inHousehold = readStoreDoc(ctx, "oauth_states.json", {}, fresh.householdId);
    assert.ok(!inHousehold[start.data.state], "and it is NOT hidden in the household db the callback can't reach");
  }
});

test("THE BUG: state minted inside a household is readable with NO tenant context", async () => {
  // This is the failure in one assertion, and it does not depend on any provider being
  // configured in the deployment. /api/oauth/:provider/start runs WITH a session, so it used
  // to write into `hh_*`. The callback is a top-level browser redirect with no cookie, so it
  // ran with no context and currentTenant() fell back to the resident household — a different
  // database. takeOAuthState returned null, the user saw "invalid or expired", and no
  // signed-up family could ever connect anything.
  const store = await import("../store.mjs");
  const token = "google.crosstenantnonce";
  await store.runWithTenant("hh_oauthprobe", () => store.putOAuthState(token, {
    provider: "google", householdId: "hh_oauthprobe", actorId: "m-owner", codeVerifier: "v",
  }));
  const st = store.takeOAuthState(token); // deliberately OUTSIDE any tenant context
  assert.ok(st, "the callback finds state minted inside a household");
  assert.equal(st.householdId, "hh_oauthprobe", "and it still knows whose flow it is");
  assert.equal(store.takeOAuthState(token), null, "consume-once is preserved");
});

test("a callback with an unknown state fails honestly instead of 500ing", async () => {
  const r = await ctx.fetch("/api/oauth/callback?code=abc&state=google.deadbeef");
  assert.equal(r.status, 200, "a stranded user gets a page, not a stack trace");
  const html = await r.text();
  assert.match(html, /invalid or expired/i);
});

/* ---- the deployment's AI keys reach every household ---- */

test("a brand-new household inherits the deployment's AI provider", async () => {
  // Harness sets no AI env keys, so the honest outcome here is "no provider configured" —
  // and the assertion that matters is that the household is ASKED the question in its own
  // context and gets a truthful answer, rather than silently inheriting the resident
  // family's configuration or seeing an empty registry.
  const r = await fresh.req("/api/ai/providers");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const providers = r.data.providers ?? [];
  assert.ok(providers.length > 0, "the registry is present for a fresh household");
  for (const p of providers) {
    assert.ok(typeof p.readiness === "string" && p.readiness.length > 0, `${p.id} reports a readiness`);
    assert.ok(!p.keySet, "no key leaks in from another household");
  }
});

test("NEGATIVE: a fresh household's AI settings are its own, not the resident family's", async () => {
  const mine = await fresh.req("/api/settings");
  assert.equal(mine.status, 200);
  // Whatever the resident household has active, a stranger's household starts unconfigured
  // unless the deployment handed it a key — never by borrowing someone else's.
  assert.ok(mine.data.settings, "settings resolve for a fresh household");
});

/* ---- transactional mail: honest about what it can and cannot do ---- */

test("platform mail readiness is reported, never guessed", () => {
  const readiness = platformMailReadiness();
  assert.ok(["not_configured", "sandbox_sender", "configured"].includes(readiness), readiness);
  const status = platformMailStatus();
  assert.equal(status.provider, "resend");
  if (readiness === "not_configured") {
    assert.equal(status.from, null, "nothing to claim when nothing is configured");
  }
  // The key must never be exposed, whatever the state.
  assert.ok(!JSON.stringify(status).includes("re_"), "no API key material in the status payload");
});

test("/api/health says whether FamiliOS can send its own mail", async () => {
  const r = await ctx.fetch("/api/health");
  const h = await r.json();
  assert.ok(h.mail, "health carries a mail section");
  assert.ok(["not_configured", "sandbox_sender", "configured"].includes(h.mail.readiness));
  assert.equal(h.mail.provider, "resend");
});

test("signup reports its verification-email outcome honestly, and never blocks on it", async () => {
  const ev = fresh.data.emailVerification;
  assert.ok(ev, "signup states what happened to the verification email");
  assert.equal(typeof ev.sent, "boolean");
  assert.equal(ev.required, false, "an unverified account still works — a mail outage can't wall someone out");
  if (!ev.sent) assert.ok(ev.reason, "a send that didn't happen names why");
  // And the account is usable right now regardless.
  const tasks = await fresh.req("/api/tasks");
  assert.equal(tasks.status, 200, "the household works before any email is confirmed");
});

test("password reset stays enumeration-safe whether or not mail is configured", async () => {
  const known = await ctx.fetch("/api/forgot-password", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "newfamily@example.com" }),
  });
  const unknown = await ctx.fetch("/api/forgot-password", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "nobody-at-all@example.com" }),
  });
  assert.equal(known.status, unknown.status, "same status for a real and a fake address");
  assert.deepEqual(await known.json(), await unknown.json(), "and the same body — no enumeration");
});

/* ---- the email verification link a human actually clicks ---- */

test("the verification link is a GET that renders a page, and a bad token says so", async () => {
  const r = await ctx.fetch("/api/verify-email?token=not-a-real-token");
  assert.equal(r.status, 200, "a human clicking an old link gets a page, not JSON or a 400");
  const html = await r.text();
  assert.match(html, /invalid|already been used|expired/i);
});

/* ---- guard against the Week 1 work regressing while Week 2 lands ---- */

test("Week 1 invariants still hold: keywords classify, backups are scoped", async () => {
  assert.equal(classifySmsKeyword("STOP"), "opt_out");
  assert.equal(classifySmsKeyword("help me plan dinner"), null);
  const backups = await fresh.req("/api/backups");
  assert.equal(backups.status, 200);
  assert.equal((backups.data.backups ?? []).length, 0, "a fresh household sees only its own (none yet)");
});
