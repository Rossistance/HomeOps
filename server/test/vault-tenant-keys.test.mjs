// One key encrypted every household's secrets.
//
// The vault held every family's connector credentials — Google refresh tokens, Twilio auth
// tokens, API keys — under a single deployment-wide key. That is not a leak by itself: the key
// file sits in the same DATA_DIR as the databases, so anyone holding one holds both.
//
// What it cost was STRUCTURAL protection against the bug this codebase keeps producing. Every
// store accessor resolves its household from the ambient tenant context, and this session alone
// found five places where that context was silently the resident household standing in for
// everybody. With one key, such a bug reads another family's connectors.json and DECRYPTS IT:
// live credentials, no error, nothing in an audit log. With a per-household derived key the
// identical bug yields nulls — the protection stops depending on every future caller getting
// the tenant right.
//
// The migration is the dangerous part. Getting it wrong means every family losing every
// connector credential at once, so most of this file is about the old format still working.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-vault-"));
const store = await import("../store.mjs");
const { encrypt, decrypt, runWithTenant, setConnectorConfig, getSecret, migrateVaultToTenantKeys, CURRENT_TENANT } = store;

const A = "hh_alpha0001";
const B = "hh_beta00002";

process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch {} });

/* ---- the isolation itself ---- */

test("a household can read back its own secret", async () => {
  const blob = await runWithTenant(A, () => encrypt("google-refresh-token-alpha"));
  const back = await runWithTenant(A, () => decrypt(blob));
  assert.equal(back, "google-refresh-token-alpha");
});

test("THE POINT: another household's ciphertext does not decrypt", async () => {
  // This is the whole feature. A tenant-context bug that reaches the wrong household's
  // connectors.json now gets null instead of a live credential.
  const blob = await runWithTenant(A, () => encrypt("google-refresh-token-alpha"));
  const stolen = await runWithTenant(B, () => decrypt(blob));
  assert.equal(stolen, null, "a wrong-tenant read must yield nothing, not a working token");
});

test("…nor does the resident household's key open a signed-up family's secret", async () => {
  const blob = await runWithTenant(A, () => encrypt("twilio-auth-token"));
  const asResident = await runWithTenant(CURRENT_TENANT, () => decrypt(blob));
  assert.equal(asResident, null, "the resident household is the one that stands in by accident");
});

test("new blobs are tagged v2 so the format is never guessed at", async () => {
  const blob = await runWithTenant(A, () => encrypt("x"));
  assert.match(blob, /^v2\./);
  assert.equal(blob.split(".").length, 4);
});

test("keys are derived, not stored — no new secret to manage", async () => {
  const files = fs.readdirSync(process.env.HOMEOPS_DATA_DIR);
  assert.ok(files.includes("key"), "the one master key still exists…");
  assert.ok(!files.some((f) => /alpha|beta|tenant.*key/i.test(f)), "…and no per-household key was written anywhere");
});

/* ---- the migration: old blobs must keep working ---- */

/** Encrypt the way the OLD code did: master key, three parts, no version tag. */
function legacyEncrypt(plain) {
  const master = Buffer.from(fs.readFileSync(path.join(process.env.HOMEOPS_DATA_DIR, "key"), "utf8"), "hex");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", master, iv);
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${ct.toString("base64")}`;
}

test("A V1 BLOB STILL DECRYPTS — this is the one that must never break", async () => {
  const old = legacyEncrypt("pre-existing-google-token");
  assert.equal(old.split(".").length, 3, "the fixture really is in the old format");
  const back = await runWithTenant(A, () => decrypt(old));
  assert.equal(back, "pre-existing-google-token");
});

test("a v1 blob decrypts from ANY household, because that is what it was — deployment-wide", async () => {
  // Honest about what the old format meant. Pretending otherwise would lock families out of
  // credentials they already have; the migration below is what actually narrows this.
  const old = legacyEncrypt("shared-era-secret");
  for (const hh of [A, B, CURRENT_TENANT]) {
    assert.equal(await runWithTenant(hh, () => decrypt(old)), "shared-era-secret");
  }
});

test("the migration moves a household's v1 secrets onto its own key", async () => {
  await runWithTenant(A, () => {
    // Plant a v1 blob the way a pre-upgrade deployment would have.
    setConnectorConfig("google", {}, { refreshToken: "will-be-rekeyed" });
    const raw = store.getConnectorConfig("google");
    raw.secrets.refreshToken = legacyEncrypt("will-be-rekeyed");
    setConnectorConfigRaw(A, "google", raw);
  });

  const moved = await runWithTenant(A, () => migrateVaultToTenantKeys());
  assert.ok(moved >= 1, `expected at least one secret rekeyed, got ${moved}`);

  const after = await runWithTenant(A, () => store.getConnectorConfig("google").secrets.refreshToken);
  assert.match(after, /^v2\./, "it is on the new format now");
  assert.equal(await runWithTenant(A, () => getSecret("google", "refreshToken")), "will-be-rekeyed",
    "and still reads back as the same credential");
  assert.equal(await runWithTenant(B, () => decrypt(after)), null, "…now invisible to anyone else");
});

test("the migration is idempotent — a second boot rewrites nothing", async () => {
  const moved = await runWithTenant(A, () => migrateVaultToTenantKeys());
  assert.equal(moved, 0);
});

test("SAFETY: an unreadable blob is LEFT ALONE, never dropped or overwritten", async () => {
  // The failure mode of being eager here is a family silently losing their Google connection.
  await runWithTenant(B, () => {
    setConnectorConfig("google", {}, { refreshToken: "placeholder" });
    const raw = store.getConnectorConfig("google");
    raw.secrets.refreshToken = "not.valid.ciphertext";
    setConnectorConfigRaw(B, "google", raw);
  });
  const moved = await runWithTenant(B, () => migrateVaultToTenantKeys());
  assert.equal(moved, 0, "nothing claimed to be migrated");
  const still = await runWithTenant(B, () => store.getConnectorConfig("google").secrets.refreshToken);
  assert.equal(still, "not.valid.ciphertext", "the bytes are exactly as they were found");
});

test("a household with no connectors at all migrates cleanly", async () => {
  assert.equal(await runWithTenant("hh_empty00003", () => migrateVaultToTenantKeys()), 0);
});

/* Plant a connector record verbatim.
 *
 * setConnectorConfig necessarily encrypts whatever it is handed, so the only way to stage a
 * pre-upgrade v1 blob is to write the doc directly. Goes through the exported storage engine
 * rather than a test-only backdoor added to store.mjs — production code should not grow an
 * export whose only caller is a test. */
function setConnectorConfigRaw(householdId, id, cfg) {
  const all = store.getConfig();
  all[id] = cfg;
  store.tenantEngine().putDoc(householdId, "connectors.json", all);
}
