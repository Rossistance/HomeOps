// BACKUPS ARE PER HOUSEHOLD — the invariant that was missing when it mattered most.
//
// Until 2026-07-30 `createBackup()` wrote ONE bundle containing every tenant into a shared
// directory, and the list/download/restore routes were gated at `minRole: "Owner"`. Every
// family that signs up is the Owner of its own household, so any registered stranger could
// enumerate the bundles, download one, and read every other family's complete data — then
// restore it and overwrite every tenant. The per-tenant databases underneath were correctly
// isolated and well tested; this one path reached around all of it.
//
// These tests are written the way the storage-isolation ones are: the negative cases carry
// the weight. It is not enough that a neighbour's backup is un-restorable; it must be
// invisible and un-downloadable, and a bundle that happens to contain another household's
// slice must not import that slice.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { startServer, stopServer } from "./harness.mjs";

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
      let out = null; try { out = await r.json(); } catch { /* non-JSON (a .gz download) */ }
      return { status: r.status, data: out, raw: r };
    },
  };
}

let alpha, beta, alphaBackup;

test("each household's snapshot lands in its own directory, named for its own tenant", async () => {
  alpha = await signup("alpha@example.com", "Alpha", "Alpha House");
  beta = await signup("beta@example.com", "Beta", "Beta House");
  assert.notEqual(alpha.householdId, beta.householdId);

  // Something worth protecting, so a leak would be legible.
  const made = await alpha.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Alpha private task", type: "task" }) });
  assert.equal(made.status, 200, JSON.stringify(made.data));

  const run = await alpha.req("/api/backups/run", { method: "POST" });
  assert.equal(run.status, 200, JSON.stringify(run.data));
  alphaBackup = run.data.name;
  assert.match(alphaBackup, /^familios-backup-[\d-]+\.json\.gz$/);

  const onDisk = join(ctx.dataDir, "backups", alpha.householdId, alphaBackup);
  assert.ok(fs.existsSync(onDisk), `snapshot written under backups/${alpha.householdId}/`);
});

test("NEGATIVE: a neighbour's backup is INVISIBLE, not merely un-restorable", async () => {
  const mine = await alpha.req("/api/backups");
  assert.equal(mine.status, 200);
  assert.equal((mine.data.backups ?? []).length, 1, "Alpha sees its own snapshot");

  const theirs = await beta.req("/api/backups");
  assert.equal(theirs.status, 200);
  assert.equal((theirs.data.backups ?? []).length, 0, "Beta sees NONE of Alpha's snapshots");
});

test("NEGATIVE: a neighbour cannot DOWNLOAD a backup even knowing its exact name", async () => {
  // The old hole in one line: same filename, different household, Owner role on both sides.
  const r = await beta.req(`/api/backups/${alphaBackup}`);
  assert.equal(r.status, 404, "not 200-with-someone-else's-data");
});

test("NEGATIVE: a neighbour cannot RESTORE from a backup it cannot see", async () => {
  const r = await beta.req("/api/backups/restore", { method: "POST", body: JSON.stringify({ name: alphaBackup }) });
  assert.equal(r.status, 422);
  assert.equal(r.data.error, "not_found");
});

test("a household CAN restore its own snapshot (the safety net still works)", async () => {
  const r = await alpha.req("/api/backups/restore", { method: "POST", body: JSON.stringify({ name: alphaBackup }) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.files > 0, "files were imported");
  const tasks = await alpha.req("/api/tasks");
  assert.ok((tasks.data.tasks ?? []).some((t) => t.title === "Alpha private task"), "the restored data is Alpha's own");
});

test("NEGATIVE: a legacy all-tenant bundle restores ONLY the caller's slice", async () => {
  // The dangerous shape: one file holding several households. A household restoring it must
  // write into its own database and nowhere else, whatever the file contains.
  const bundle = {
    meta: { at: new Date().toISOString(), app: "familios", format: 2, count: 2, tenants: [beta.householdId, alpha.householdId] },
    tenants: {
      [beta.householdId]: { files: { "tasks.json": [{ id: "t_beta_restored", title: "Beta from bundle", type: "task", householdId: beta.householdId }] }, audit: "" },
      [alpha.householdId]: { files: { "tasks.json": [{ id: "t_alpha_poison", title: "POISON into Alpha", type: "task", householdId: alpha.householdId }] }, audit: "" },
    },
  };
  const name = "familios-backup-2020-01-01.json.gz";
  const dir = join(ctx.dataDir, "backups", beta.householdId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, name), gzipSync(JSON.stringify(bundle)));

  const r = await beta.req("/api/backups/restore", { method: "POST", body: JSON.stringify({ name }) });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  const betaTasks = await beta.req("/api/tasks");
  assert.ok((betaTasks.data.tasks ?? []).some((t) => t.id === "t_beta_restored"), "Beta got its own slice");

  const alphaTasks = await alpha.req("/api/tasks");
  assert.ok(!(alphaTasks.data.tasks ?? []).some((t) => t.id === "t_alpha_poison"),
    "Beta's restore did NOT write into Alpha's database");
});

test("NEGATIVE: a format-3 bundle stamped for another tenant is refused, not imported", async () => {
  const name = "familios-backup-2020-01-02.json.gz";
  const dir = join(ctx.dataDir, "backups", beta.householdId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, name), gzipSync(JSON.stringify({
    meta: { at: new Date().toISOString(), app: "familios", format: 3, tenant: alpha.householdId, count: 1 },
    files: { "tasks.json": [{ id: "t_mislabelled", title: "Mislabelled", type: "task" }] }, audit: "",
  })));
  const r = await beta.req("/api/backups/restore", { method: "POST", body: JSON.stringify({ name }) });
  assert.equal(r.status, 422);
  assert.equal(r.data.error, "tenant_mismatch");
});

test("path traversal in a backup name is refused", async () => {
  for (const bad of ["../../key", "..%2Fkey", "familios-backup-2020-01-01.json.gz/../../key"]) {
    const r = await alpha.req(`/api/backups/${encodeURIComponent(bad)}`);
    assert.equal(r.status, 404, `refused: ${bad}`);
  }
});

test("the legacy all-tenant surface 404s for a household Owner (operator env unset)", async () => {
  // Operator authority lives in HOMEOPS_OPERATOR_EMAILS, which no household can grant
  // itself; with it unset NOBODY is an operator and the routes do not exist.
  const list = await alpha.req("/api/admin/legacy-backups");
  assert.equal(list.status, 404);
  const restore = await alpha.req("/api/admin/legacy-backups/restore", { method: "POST", body: JSON.stringify({ name: "familios-backup-2020-01-01.json.gz" }) });
  assert.equal(restore.status, 404);
});

test("deleting a household deletes its snapshots too", async () => {
  const dir = join(ctx.dataDir, "backups", beta.householdId);
  assert.ok(fs.existsSync(dir), "Beta has a backup directory before deletion");
  const del = await beta.req("/api/account", { method: "DELETE", body: JSON.stringify({ password: "correct horse battery" }) });
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.equal(del.data.deleted, "household");
  assert.ok(!fs.existsSync(dir),
    "30 days of complete household data must not survive 'delete my account'");
});
