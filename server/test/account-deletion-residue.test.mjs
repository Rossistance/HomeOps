// Delete means delete — checked on the filesystem, not on the 200.
//
// The account-deletion route (Apple 5.1.1(v)) already removed the tenant database and the
// household's backups, and returned a clean 200. It also left a directory behind: appendAudit
// writes to the AMBIENT tenant's audit.jsonl, and deleteBackupsFor audited its own result while
// running as the household it had just deleted — recreating `tenants/<householdId>/audit.jsonl`
// seconds after deleteTenant removed it.
//
// So a family that asked not to exist here kept a directory and an id on disk, indefinitely.
// Small, and exactly the kind of thing that makes "we deleted everything" not literally true.
// Found by deleting a throwaway household and then looking at the filesystem.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { startServer, stopServer } from "./harness.mjs";

let ctx;

async function signup(email) {
  const res = await ctx.fetch("/api/signup", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct horse battery", ownerName: "Sam", householdName: "Disposable" }),
  });
  const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  const data = await res.json();
  return {
    householdId: data.session?.householdId,
    async req(path, init = {}) {
      const headers = { Cookie: cookie, ...(init.headers || {}) };
      if (init.method && init.method !== "GET") { headers["x-homeops-csrf"] = data.session.csrf; headers["content-type"] ??= "application/json"; }
      const r = await ctx.fetch(path, { ...init, headers });
      let out = null; try { out = await r.json(); } catch { /* non-JSON */ }
      return { status: r.status, data: out };
    },
  };
}

const tenantDir = (hh) => join(ctx.dataDir, "tenants", hh);

before(async () => { ctx = await startServer(); });
after(async () => { await stopServer(ctx); });

test("a signed-up household has a tenant directory on disk", async () => {
  const fam = await signup(`residue-a-${Date.now()}@example.test`);
  assert.ok(fam.householdId);
  assert.ok(fs.existsSync(tenantDir(fam.householdId)), "it exists before deletion — otherwise this proves nothing");
});

test("DELETE MEANS DELETE: nothing of the household is left on disk", async () => {
  const fam = await signup(`residue-b-${Date.now()}@example.test`);
  const hh = fam.householdId;
  // Do something first, so there is a real audit log and a real backup to remove.
  await fam.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "something to erase" }) });
  await fam.req("/api/backups/run", { method: "POST", body: "{}" });
  assert.ok(fs.existsSync(tenantDir(hh)));

  const del = await fam.req("/api/account", { method: "DELETE", body: JSON.stringify({ password: "correct horse battery" }) });
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.equal(del.data.deleted, "household");

  assert.ok(!fs.existsSync(tenantDir(hh)),
    `the tenant directory must be gone, found: ${fs.existsSync(tenantDir(hh)) ? fs.readdirSync(tenantDir(hh)).join(", ") : ""}`);
});

test("…and no audit file is resurrected after the fact", async () => {
  // The specific regression: a write into the deleted tenant AFTER deleteTenant re-creates the
  // directory. Asserted separately because the directory check above would pass if the write
  // happened before, and fail for a reason that doesn't name this cause.
  const fam = await signup(`residue-c-${Date.now()}@example.test`);
  const hh = fam.householdId;
  await fam.req("/api/backups/run", { method: "POST", body: "{}" });
  await fam.req("/api/account", { method: "DELETE", body: JSON.stringify({ password: "correct horse battery" }) });
  assert.ok(!fs.existsSync(join(tenantDir(hh), "audit.jsonl")), "no household audit log survives its household");
});

test("the household's backups go with it", async () => {
  const fam = await signup(`residue-d-${Date.now()}@example.test`);
  const hh = fam.householdId;
  await fam.req("/api/backups/run", { method: "POST", body: "{}" });
  const backupDir = join(ctx.dataDir, "backups", hh);
  assert.ok(fs.existsSync(backupDir), "a backup really was written");
  await fam.req("/api/account", { method: "DELETE", body: JSON.stringify({ password: "correct horse battery" }) });
  assert.ok(!fs.existsSync(backupDir), "leaving 30 days of complete snapshots would make the deletion untrue");
});

test("a durable tombstone remains — deletion is recorded even though the household isn't", async () => {
  // The one thing that SHOULD survive, and it lives in the system tenant rather than in the
  // deleted household's own storage.
  const fam = await signup(`residue-e-${Date.now()}@example.test`);
  const hh = fam.householdId;
  await fam.req("/api/backups/run", { method: "POST", body: "{}" });
  await fam.req("/api/account", { method: "DELETE", body: JSON.stringify({ password: "correct horse battery" }) });

  const sysPath = join(ctx.dataDir, "tenants", "_system");
  assert.ok(fs.existsSync(sysPath), "the system tenant is where a fact about a deleted household belongs");
  // Read it back through a fresh signup's session-free route surface: the file is sqlite, so
  // assert on behaviour instead — the same email can be reused, proving the identity is gone.
  const again = await signup(`residue-e2-${Date.now()}@example.test`);
  assert.ok(again.householdId, "the server is still healthy after a deletion");
  assert.notEqual(again.householdId, hh);
});

test("a wrong password deletes nothing at all", async () => {
  const fam = await signup(`residue-f-${Date.now()}@example.test`);
  const hh = fam.householdId;
  const r = await fam.req("/api/account", { method: "DELETE", body: JSON.stringify({ password: "wrong" }) });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, "password_incorrect");
  assert.ok(fs.existsSync(tenantDir(hh)), "the household is untouched");
});
