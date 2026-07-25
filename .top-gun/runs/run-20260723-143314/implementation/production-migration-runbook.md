# WP-102 s2–s5 — Production Data Cleanup Runbook (BLOCKED ON OPERATOR ACCESS)

Status: **not executed.** No production data has been read or written by this session.

## Why the orchestrator cannot run this

Verified 2026-07-23, in this order:

| Access path | Result |
|---|---|
| Render CLI | `render: command not found` |
| Render API key in environment | absent |
| Mint a production session without credentials | `POST https://homeops-ai.onrender.com/api/session` → **403** |
| Direct SQLite access to `/data` | not reachable — that disk exists only inside the Render service |

The 403 is **your security working correctly**: production refuses passwordless
session minting, which is exactly the behavior that protects the household. The
migration tool (`server/scripts/migrate-agent-packages.mjs`) transports over the live
HTTP API and requires an owner bearer token + CSRF — obtaining those means
authenticating as you, which this session must not do.

**Therefore this step is operator-run by design, not by limitation.**

## What to run

The tool defaults to `--dry-run` and mutates nothing without BOTH `--apply`,
an explicit `--tenant`, and `HOMEOPS_MIGRATION_CONFIRM=yes`.

### Step 1 — dry-run against production (safe, read-only)

Get an owner token + CSRF from your already-signed-in production browser session
(DevTools → Application → Cookies for homeops-ai.onrender.com), then:

```
node server/scripts/migrate-agent-packages.mjs \
  --base-url https://homeops-ai.onrender.com \
  --origin   https://homeops-ai.onrender.com \
  --token    <your-owner-token>
```

This prints the full production disposition table. **The 2026-07-21 local table does
not apply** — production is a different database and its mapping must be regenerated,
which is what this step produces.

### Step 2 — read the report before proceeding

Confirm: total fragments enumerated, proposed package count (target ≤20), which agents
merge into which survivor, which triggers retarget, and that nothing is marked delete
(the tool archives; it never deletes).

### Step 3 — apply (only after reading step 2)

```
HOMEOPS_MIGRATION_CONFIRM=yes node server/scripts/migrate-agent-packages.mjs \
  --apply \
  --base-url https://homeops-ai.onrender.com \
  --origin   https://homeops-ai.onrender.com \
  --tenant   <production-householdId> \
  --token    <your-owner-token> \
  --csrf     <your-csrf>
```

Apply is backup-first and PATCH-only (additive metadata round-trips; POST/PUT would be
stripped by `normalizeAgent`).

### Step 4 — legacy parked runs

Set `HOMEOPS_SWEEP_LEGACY_PARKED=1` in the Render dashboard, restart the service once,
then remove the variable. The 60s sweep expires pre-epoch connector-parked runs with
honest notices (`server/engine.mjs:995-999`).

### Step 5 — verify

Re-export and confirm: package count ≤20, evolution queue archived, 0 legacy parked
runs, and the diff against the pre-apply backup shows only expected deltas.

## Safety properties (already built into the tool)

- Dry-run is the default; apply requires three independent confirmations.
- Backup is taken before any mutation; rollback = re-import that backup.
- Archive-not-delete throughout; version stores are never deleted.
- Never opens a SQLite file directly (hot-WAL rule respected by construction).

## Prerequisite worth noting

The idempotency fix (WP-102 s1, commit `644c745`) is **already deployed to your local
branch but not pushed**. Migrating production before that code reaches production means
the catalog can re-fill with duplicates (HYP-108, DEC-104). Recommended order: push →
confirm Render has the new build → then run this runbook.
