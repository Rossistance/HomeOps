// "Give me everything you hold about my family."
//
// A backup is a RESTORE artifact: gzipped, shaped for tenant-db's importer, and containing the
// household's encrypted credentials because a restore needs them. Handing a family that file
// and calling it their data is technically true and practically useless — and shipping someone
// their own OAuth refresh tokens, even encrypted, is a liability nobody asked for.
//
// So the export is a different artifact, and the part that has to be right is the REDACTION:
// an export that leaks credentials is worse than no export, and one that silently omits family
// data is the same small lie this codebase keeps finding.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, owner, adult, signedUp;

async function signup(email, householdName) {
  const res = await ctx.fetch("/api/signup", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct horse battery", ownerName: "Sam", householdName }),
  });
  const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  const data = await res.json();
  return {
    householdId: data.session?.householdId,
    async raw(path) {
      const r = await ctx.fetch(path, { headers: { Cookie: cookie } });
      return { status: r.status, text: await r.text() };
    },
    async req(path, init = {}) {
      const headers = { Cookie: cookie, ...(init.headers || {}) };
      if (init.method && init.method !== "GET") { headers["x-homeops-csrf"] = data.session.csrf; headers["content-type"] ??= "application/json"; }
      const r = await ctx.fetch(path, { ...init, headers });
      let out = null; try { out = await r.json(); } catch { /* non-JSON */ }
      return { status: r.status, data: out };
    },
  };
}

// Both session helpers parse a JSON body, and the export IS JSON — the download headers don't
// change that, which is the point of choosing JSON over a gzip for this artifact.
const exportAs = async (as) => {
  const r = await as.req("/api/export");
  return { status: r.status, bundle: r.data };
};

before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");        // Owner
  adult = await makeSession(ctx, "m-morgan");      // Adult Admin
  signedUp = await signup(`export-${Date.now()}@example.test`, "The Rivera Family");
  // Real data to find in the export, and a real credential that must NOT be in it.
  await owner.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "EXPORTABLE-TASK-MARKER" }) });
  await owner.req("/api/settings", { method: "POST", body: JSON.stringify({ ownerPin: "8213" }) });
});
after(async () => { await stopServer(ctx); });

test("an Owner can export, and it comes back as a real bundle", async () => {
  const { status, bundle } = await exportAs(owner);
  assert.equal(status, 200);
  assert.equal(bundle.meta.app, "familios");
  assert.equal(bundle.meta.format, 1);
  assert.ok(bundle.meta.at, "stamped with when it was taken");
});

test("the export contains the household's actual data", async () => {
  const { status, bundle } = await exportAs(owner);
  assert.equal(status, 200);
  assert.equal(bundle.meta.kind, "household-export");
  assert.ok(bundle.meta.collections > 0, "it is not an empty file");
  assert.match(JSON.stringify(bundle.data), /EXPORTABLE-TASK-MARKER/, "the task the family created is in there");
});

test("THE REDACTION: the household PIN hash is not in the export", async () => {
  // Set above via /api/settings. An export that ships the credential guarding elevated sign-in
  // is worse than no export at all.
  const { bundle } = await exportAs(owner);
  const raw = JSON.stringify(bundle);
  assert.ok(!/ownerPinHash":"\$/.test(raw), "no hash value survived");
  assert.match(raw, /redacted/i, "…and the file says redaction happened rather than hiding it");
});

test("THE REDACTION: connector secrets are removed but their NAMES survive", async () => {
  // Knowing WHICH credentials a household holds is part of what an export should tell them —
  // "you have a Google refresh token here" is data about them. The value is not.
  // The config route takes a FLAT body keyed by the connector's own configSchema, so the
  // secret field is named directly rather than nested under `secrets`.
  const saved = await owner.req("/api/connectors/webhook/config", { method: "POST", body: JSON.stringify({ signingSecret: "SUPER-SECRET-VALUE-XYZ" }) });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));

  const { bundle } = await exportAs(owner);
  const raw = JSON.stringify(bundle);
  assert.ok(!raw.includes("SUPER-SECRET-VALUE-XYZ"), "the plaintext is obviously not there…");
  const secrets = bundle.data["connectors.json"]?.webhook?.secrets;
  assert.ok(secrets, "the connector record itself survives — this is data about the household");
  assert.deepEqual(Object.keys(secrets), ["signingSecret"], "the field NAME is kept: knowing which credentials you hold is your data");
  assert.match(String(secrets.signingSecret), /redacted/i, "…and the value is not");
  assert.ok(bundle.meta.redactedFiles.includes("connectors.json"), "the manifest names the file it redacted");
});

test("THE REDACTION: no ciphertext blob rides along either", async () => {
  // The stored form is `v2.iv.tag.ct`. Exporting that would be shipping the credential in the
  // one format an attacker with the key file could actually use.
  const { bundle } = await exportAs(owner);
  assert.ok(!/"v2\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\./.test(JSON.stringify(bundle)), "no vault blob in the file");
});

test("the export says what it does NOT include", async () => {
  // An export that silently omits things is worse than one that omits them out loud: the
  // reader has no way to know to ask.
  const { bundle } = await exportAs(owner);
  assert.ok(Array.isArray(bundle.meta.excluded) && bundle.meta.excluded.length >= 2);
  assert.match(bundle.meta.excluded.join(" "), /credential/i);
  assert.match(bundle.meta.excluded.join(" "), /file/i);
});

test("the activity log travels with it — it is the record of what was done on their behalf", async () => {
  const { bundle } = await exportAs(owner);
  assert.ok(Array.isArray(bundle.audit));
  assert.ok(bundle.audit.length > 0, "a household that has done things has an activity log");
  assert.ok(bundle.audit.some((e) => typeof e.type === "string"), "and it is parsed, not a blob of text");
});

test("SCOPE: one household's export contains nothing of another's", async () => {
  const theirs = await exportAs(signedUp);
  assert.equal(theirs.status, 200);
  assert.equal(theirs.bundle.meta.householdId, signedUp.householdId);
  assert.ok(!JSON.stringify(theirs.bundle).includes("EXPORTABLE-TASK-MARKER"),
    "a signed-up family's export must not contain the resident household's data");
});

test("an Adult Admin cannot take the whole household's data", async () => {
  // It spans every member's personal space. A household export is not one person's to take.
  const r = await adult.req("/api/export");
  assert.equal(r.status, 403);
});

test("a stranger with no session gets nothing", async () => {
  const r = await ctx.fetch("/api/export");
  assert.ok(r.status === 401 || r.status === 403, `expected a refusal, got ${r.status}`);
});
