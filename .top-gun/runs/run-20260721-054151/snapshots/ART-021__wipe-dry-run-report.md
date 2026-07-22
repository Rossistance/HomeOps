# WP-008b — Improvements/Evolution Wipe: DRY-RUN REPORT (read-only)

- Mission: run-20260721-054151 · Work package WP-008 (safe wipe / selective revert) · Decision DEC-015
- Tenant analyzed: `local` (the resident family household)
- Produced: 2026-07-21 (UTC) by the WP-008b dry-run analyst
- Mode: **STRICTLY READ-ONLY.** No tenant data, repo source, git, or server state was mutated. The live `household.db` was opened `readOnly:true` via `node:sqlite` (the dev server holds a live WAL writer; no lock was taken, no checkpoint performed).

---

## 0. Headline (read this first)

DEC-015 scopes the selective revert to **"the auto-applied instruction rewrites sitting in agents/skills (15 accepted)."** The record-level data does **not** support that framing:

1. **ZERO of the 15 accepted evolution records were auto-applied.** Every one carries `reviewedBy` = a human actor (`m-owner` or `m-alex`); **none** has `reviewedBy:"ai"` or `autoApproved:true`. `settings.autoApproveImprovements` is **unset** (default-on), yet the auto-approval path in `engine.mjs:807-826` never actually fired for any record in this tenant. **The DEC-015 "auto-approved" revert set is empty.**
2. **Only 3 of the 15 accepted records actually mutated any `instructions`/`planner_guidance` field.** The other 12 changed nothing (see §3): 9 are trace records with no `after` payload (the human-review route at `index.mjs:3090` only applies when `after` is present), and 3 are `kind:"tool"` records that have no agent/skill field to write to.
3. **Of those 3 real mutations, only 1 hit a still-existing entity** — and it is a genuine, still-live corruption: a **weather** fallback note was written as the **entire `instructions`** of the **Gmail Promotional Cleanup Agent** (`agt_b805192d4c2a6fd95513`), overwriting its whole Gmail policy. It was **human-accepted** (`m-owner`), so under DEC-015 it defaults to *keep-unless-opted*; I recommend the user opt to revert it. Its clean prior version is intact.
4. **11 of the 15 accepted records target agents/skills that no longer exist** (deleted during earlier experimentation). These are inert.

Net effect on the plan: there is **nothing to auto-revert** under DEC-015 as written. There is **1 human-accepted live mutation to put to the user for an opt-in revert**, **2 mutations against deleted skills** (no live target → restore-from-backup only), and **12 no-op acceptances**. All 21 rows can still be archived per DEC-015.

> Note on mechanics: the engine does **not** currently store a `beforeVersionId` on evolution records (WP-008 proposes adding it at `engine.mjs:807-826`). Today the record→prior-version link must be **reconstructed by timestamp correlation** — matching each accepted record's `reviewedAt` to the `snapshotAt` of the pre-apply snapshot in `agent_versions.json`/`skill_versions.json`. Where that correlation is unambiguous I mark it *confirmed*; where two accepts hit the same (now-deleted) entity I mark it *unconfirmed* and fall back to the restore-from-backup path (DEC-015's stated reversal condition).

---

## 1. Storage layout (as learned from `tenant-db.mjs` / `store.mjs`)

- One SQLite DB per household: `server/.data/tenants/local/household.db` (+ `audit.jsonl`, `files/`). WAL mode is on (`-wal`/`-shm` present).
- Two table shapes: `records(collection, id, doc)` for keyed collections, `kv(file, doc)` for whole-doc files. `exportTenant()` re-emits both as `{"<file>.json": value}` — the exact shape `backup.mjs` format-2 bundles use.
- Evolution records live in the `evolution` collection (`store.mjs` `keyedCollection("evolution.json")`).
- Version stores are **kv** docs: `agent_versions.json` (keyed by agentId → array of full-agent snapshots, each with its own `version` + `snapshotAt`, capped at 20) and `skill_versions.json` (same, per skillId). `snapshotAgent()`/`snapshotSkill()` capture the **pre-change** state *before* the new value is written (`agents.mjs:21`, `skills.mjs:18`), so every applied change leaves a recoverable predecessor.
- Apply paths: auto = `engine.mjs:813-821` (`partialUpdateAgent({instructions})` / `partialUpdateSkill({planner_guidance})`, then `patchEvolution(status:"accepted", reviewedBy:"ai", autoApproved:true)`); human = `index.mjs:3090-3101` (same `partialUpdate*`, then `reviewedBy: session.actorId`) — **and only when `accept && e.after`.**

---

## 2. Summary table — all 21 evolution records

Mode legend: **auto** = `reviewedBy:"ai"`+`autoApproved` · **human** = `reviewedBy` is an actor id · Field applied only when a real `instructions`/`planner_guidance` write occurred.

| # | Record id | Status | Target (kind → id → name) | Field | Mode | Prior version? | Proposed action |
|---|---|---|---|---|---|---|---|
| 1 | evo_aa2f79ec549bcaea | accepted | agent → `agt_b805192d4c2a6fd95513` → **Gmail Promotional Cleanup Agent** (EXISTS) | instructions | human (m-owner) | **YES — `agent_versions[agt_b805192d4c2a6fd95513]` v1 @2026-07-03T06:53:33.327Z (confirmed)** | **USER-DECISION-NEEDED — recommend REVERT to v1** (weather note clobbered Gmail policy; still live) |
| 2 | evo_7599690f2f415bb3 | accepted | skill → `skl_269f3f6369b95dcea2df` → *(DELETED)* | planner_guidance | human (m-owner) | history present (`skill_versions` v3) but **live skill gone** (unconfirmed link) | CANNOT-REVERT — target deleted; restore-from-backup only if resurrected |
| 3 | evo_08433863499947cc | accepted | skill → `skl_269f3f6369b95dcea2df` → *(DELETED)* | planner_guidance | human (m-owner) | history present but **live skill gone** (unconfirmed) | CANNOT-REVERT — target deleted |
| 4 | evo_f2732e2373596627 | accepted | tool → *(no target field)* | — | human (m-owner) | n/a | KEEP — advisory-only; no instruction/guidance mutation |
| 5 | evo_1f64ec77d5a6dbe2 | accepted | tool → *(no target field)* | — | human (m-owner) | n/a | KEEP — no mutation |
| 6 | evo_15020bf3a4149c48 | accepted | tool → *(no target field)* | — | human (m-owner) | n/a | KEEP — no mutation |
| 7 | evo_f05059d88bd3277f | accepted | agent → `agt_e9259e9380c9696397e6` → *(DELETED)* | instructions | human (m-alex) | n/a (no `after` → not applied) | KEEP — status-only; no mutation; target gone |
| 8 | evo_36bab6fba5146b49 | accepted | agent → `agent_mqpnscbo1uvg0oj` → *(DELETED)* | instructions | human (m-owner) | n/a (no `after`) | KEEP — no mutation; target gone |
| 9 | evo_4b6f8bbb85718f33 | accepted | agent → `agent_mqvtci5a125y0im6` → *(DELETED)* | instructions | human (m-owner) | n/a (no `after`) | KEEP — no mutation; target gone |
| 10 | evo_f73bc58423343ad3 | accepted | agent → `agent_mqvtrtvf1s5rh3ix` → *(DELETED)* | instructions | human (m-owner) | n/a (no `after`) | KEEP — no mutation; target gone |
| 11 | evo_96b7f7baac4bbdeb | accepted | agent → `agent_mqvtrtvf1s5rh3ix` → *(DELETED)* | instructions | human (m-owner) | n/a (no `after`) | KEEP — no mutation; target gone |
| 12 | evo_6c4902adc6675d18 | accepted | agent → `agent_mqvtrtvf1s5rh3ix` → *(DELETED)* | instructions | human (m-owner) | n/a (no `after`) | KEEP — no mutation; target gone |
| 13 | evo_53a8adcd3e7fd2da | accepted | agent → `agent_mqvtrtvf1s5rh3ix` → *(DELETED)* | instructions | human (m-owner) | n/a (no `after`) | KEEP — no mutation; target gone |
| 14 | evo_dd315eeb4822ea48 | accepted | agent → `agt_e9259e9380c9696397e6` → *(DELETED)* | instructions | human (m-owner) | n/a (no `after`) | KEEP — no mutation; target gone |
| 15 | evo_7215f9d63b7bc56a | accepted | agent → `agt_e9259e9380c9696397e6` → *(DELETED)* | instructions | human (m-owner) | n/a (no `after`) | KEEP — no mutation; target gone |
| 16 | evo_42ff487b2911b87d | pending | skill → `skl_cf7b28f7bf4dcd8534ef` → **Gmail Promotional Email Social Tag Cleanup** (EXISTS) | planner_guidance | — (unreviewed) | n/a (never applied) | NO ACTION — pending; never applied |
| 17 | evo_006e21a54000d403 | rejected | skill → `skl_615f62a7d3ddd073a5df` → *(DELETED)* | — | — | n/a | NO ACTION — rejected; never applied |
| 18 | evo_f9e25804582e64b1 | rejected | agent → `agt_b805192d4c2a6fd95513` → Gmail Promotional Cleanup Agent (EXISTS) | — | — | n/a | NO ACTION — rejected; never applied |
| 19 | evo_e9f7de21a6990cfc | rejected | agent → `agent_mr3olp1a1m9oir3k` → *(DELETED)* | — | — | n/a | NO ACTION — rejected; never applied |
| 20 | evo_fe7907644e364f59 | rejected | tool → *(no target field)* | — | — | n/a | NO ACTION — rejected; never applied |
| 21 | evo_ab755837bdea8b62 | rejected | tool → *(no target field)* | — | — | n/a | NO ACTION — rejected; never applied |

**Tally (accepted, n=15):** auto-applied revert candidates (DEC-015 scope) = **0** · keep (no mutation) = **12** · cannot-revert (target deleted) = **2** · user-decision-needed (live mutation, revert recommended) = **1** · unknown mode = **0**.
**Non-accepted (n=6):** 5 rejected + 1 pending — all confirmed never-applied (see §5).

---

## 3. Per-record diffs

Instruction/guidance values in this tenant are single-line strings, so each real change is a whole-line replace (2-line unified diff: one `-` old, one `+` new). Only the 3 records below applied a change; all diffs are complete (not truncated). **Data note:** the stored *before* texts are themselves exactly 800 characters and end mid-sentence — that truncation is in the stored snapshot, not introduced here; a revert would restore exactly that 800-char value.

### 3.1 evo_aa2f79ec549bcaea — agent `agt_b805192d4c2a6fd95513` (Gmail Promotional Cleanup Agent) · human (m-owner) · **APPLIED, LIVE**
- Title: "Use local file fallback when weather fetch fails" · source: ai · risk: Low
- Origin: a **weather** run's failure trace (`weather.current` "fetch failed"). The proposal's `after` is a weather-fallback sentence — but it was applied to a **Gmail** agent, replacing its entire policy.
- Prior version (revert target): `agent_versions[agt_b805192d4c2a6fd95513]` **v1** @2026-07-03T06:53:33.327Z. Live agent is now **v2**, `instructions.length` = 208, and live `instructions` **== this record's `after`** (corruption confirmed live).

```diff
- When run, scan the last 200 unread messages in the Gmail inbox. Identify only clear marketing, sales, promotional, product-offer, commercial newsletter, or campaign-style emails. Exclude personal correspondence, school/daycare, medical, bills/receipts, travel, legal, household logistics, and anything that appears urgent or account/security-related. List candidate emails by sender and subject before modification. Require approval before using gmail.modifyLabels. After approval, add the Gmail Social label/category, remove UNREAD, and remove Primary category if Gmail labels expose that option. Then summarize the modified emails in HomeOps chat and send/draft the same list to the HomeOps inbox. If no Social label/category is available, stop before modification and report that Gmail needs the a  [800 chars, stored value ends here]
+ When weather.current returns a fetch failure, attempt the pending Local Files import for current data before reporting failure; if both are unavailable, explain that current conditions could not be retrieved.  [208 chars]
```

### 3.2 evo_7599690f2f415bb3 — skill `skl_269f3f6369b95dcea2df` *(DELETED)* · human (m-owner) · APPLIED (target now gone)
- Title: "Validate notification draft body before sending" · source: ai · risk: Low
- Prior state at apply: `skill_versions[skl_269f3f6369b95dcea2df]` v3 @2026-07-03T06:19:49.455Z (a Gmail promo-triage `planner_guidance`). Linkage **unconfirmed** (two accepts hit this same skill and the skill was later deleted). The live skill no longer exists → there is nothing live to revert.

```diff
- Search Gmail for up to 200 unread inbox messages. Classify only clear marketing, sales, promotional, product-offer, newsletter-style, or commercial campaign emails as candidates. Do not modify personal, school, medical, billing, travel, legal, household, or time-sensitive emails. Before changing Gmail, prepare the candidate list and require approval for the label/read operation. Use Gmail labels carefully: first list labels to confirm the available Social label or Gmail social category naming; then apply the appropriate Social label/category and remove UNREAD. If Gmail supports Primary category removal via labels, remove the Primary category where available; otherwise confirm removal from the unread Primary view by noting they are read and Social-labeled. Return a list in chat and send/dra  [800 chars, stored value ends here]
+ Tool tip: Only call `homeops.send_notification_draft` with a non-empty body containing the intended summary and sender/subject list.  [132 chars]
```

### 3.3 evo_08433863499947cc — skill `skl_269f3f6369b95dcea2df` *(DELETED)* · human (m-owner) · APPLIED (target now gone)
- Title: "Add a non-empty final response guard" · source: ai · risk: Low
- Same deleted skill as §3.2; same before-state snapshot (v3). Linkage **unconfirmed**; no live target to revert.

```diff
- Search Gmail for up to 200 unread inbox messages. Classify only clear marketing, sales, promotional, product-offer, newsletter-style, or commercial campaign emails as candidates. Do not modify personal, school, medical, billing, travel, legal, household, or time-sensitive emails. Before changing Gmail, prepare the candidate list and require approval for the label/read operation. Use Gmail labels carefully: first list labels to confirm the available Social label or Gmail social category naming; then apply the appropriate Social label/category and remove UNREAD. If Gmail supports Primary category removal via labels, remove the Primary category where available; otherwise confirm removal from the unread Primary view by noting they are read and Social-labeled. Return a list in chat and send/dra  [800 chars, stored value ends here]
+ Before ending, always return a non-empty final message. Keep it concise: include the number of Gmail messages modified, the labels/actions applied, and if the detailed list is long, summarize instead of risking an empty response.  [229 chars]
```

### 3.4 Records 4–15 (no diff — nothing was applied)
- **evo_f2732e2373596627, evo_1f64ec77d5a6dbe2, evo_15020bf3a4149c48** (`kind:"tool"`): each carries an `after` proposal about passing `messageIds` into `gmail.modifyLabels`, but the review route has **no branch for tool-kind**, so `applied=false` and no `instructions`/`planner_guidance` was ever written. No before→after diff exists. Action: KEEP (advisory acceptance only).
- **evo_f05059d88bd3277f, evo_36bab6fba5146b49, evo_4b6f8bbb85718f33, evo_f73bc58423343ad3, evo_96b7f7baac4bbdeb, evo_6c4902adc6675d18, evo_53a8adcd3e7fd2da, evo_dd315eeb4822ea48, evo_7215f9d63b7bc56a** (`kind:"agent"`, `source:"trace"`): these have **no `after` payload** (deterministic trace baselines whose AI-enrichment never completed), so the review route applied nothing. Their target agents are all deleted besides. No diff exists. Action: KEEP (status-only).

---

## 4. Proposed execution plan (for later execution ONLY after explicit user approval, by someone else)

> A **fresh backup MUST be re-taken immediately before any real execution** — the step-2 dry-run backup is a snapshot at 2026-07-21T12:29:58Z and the running dev server may have advanced the data since.

### Step A — Selective revert
- **DEC-015 auto-approved set: EMPTY → no automatic reverts to perform.** Do not fabricate one.
- **Put evo_aa2f79ec549bcaea to the user for an opt-in revert decision.** If the user approves: restore `agent_versions[agt_b805192d4c2a6fd95513]` **v1** into the live agent — either `rollbackAgent("agt_b805192d4c2a6fd95513", 1)` or `partialUpdateAgent("agt_b805192d4c2a6fd95513", { instructions: <v1.instructions> })`. Both snapshot the current v2 first and bump to v3, so the revert is itself reversible and audited. (Note: v1's stored `instructions` is the 800-char value shown in §3.1; confirm the user is content restoring exactly that.)
- **evo_7599690f2f415bb3 & evo_08433863499947cc:** target skill `skl_269f3f6369b95dcea2df` is deleted; there is no live entity to revert. Take no live action. If the user wants that skill (and its pre-change guidance) back, that is a **restore-from-backup / re-create** decision, not a revert — surface separately.
- **All other accepted records:** KEEP (they applied nothing).

### Step B — Archive evolution rows (archive-not-delete, per DEC-015)
- Copy all 21 `evolution` rows into a new `evolution_archive` collection (each with `archivedAt`, `archivedBy`, `archiveReason: "WP-008b DEC-015"`), then optionally clear the active `evolution` collection so the Improvements tab reads clean.
- **Never delete** `agent_versions.json` / `skill_versions.json` (they are the revert substrate and DEC-015's reversal path). Version stores are untouched by the archive.

### Step C — Verification (WP-008 acceptance)
1. Live agents' `instructions` == their last human-authored version: for `agt_b805192d4c2a6fd95513`, assert `instructions == agent_versions v1` (if reverted); for every other live agent, assert `instructions` is byte-identical to pre-run (none were mutated by evolution, so they must be unchanged).
2. `evolution_archive` count == 21 (or the archived subset chosen); active `evolution` == the intended remainder.
3. Version stores unchanged in size/entry-count except the one intended new snapshot from a revert.
4. **Skill smoke:** invoke each of the 13 resident skills (and the 22-UC invocation smoke) to confirm all still invoke post-archive.
5. Re-run the read-only export and **diff against the step-2 backup** — the only differences should be (a) the single reverted agent and (b) the evolution→archive move. Anything else is unexpected and must halt execution.

---

## 5. Safety cross-check

- **Pending (1):** evo_42ff487b2911b87d — status `pending`, never reviewed, so the apply branch never ran → no mutation. Its target skill `skl_cf7b28f7bf4dcd8534ef` **exists**. **No action required.**
- **Rejected (5):** evo_006e21a54000d403, evo_f9e25804582e64b1, evo_e9f7de21a6990cfc, evo_fe7907644e364f59, evo_ab755837bdea8b62 — the review route only applies on `accept=true`, so a `rejected` status guarantees **no `instructions`/`planner_guidance` write occurred**. Several still carry an unused `after` proposal; that is inert. **No action required.**
- **Missing-target flag (task 5):** **11 of 15 accepted records point at agents/skills that no longer exist:** agents `agt_e9259e9380c9696397e6` (×3), `agent_mqpnscbo1uvg0oj` (×1), `agent_mqvtci5a125y0im6` (×1), `agent_mqvtrtvf1s5rh3ix` (×4); skill `skl_269f3f6369b95dcea2df` (×2). None of these can degrade current live behavior (their targets are gone). 9 of the 11 also never applied anything. The 2 that did (the deleted skill) have no live target to revert.
- **Consistency with the audit:** the audit's EV-031 count of "15 accepted" is correct, but its characterization of them as **auto-applied** is not borne out at the record level — all 15 are human-reviewed and only 3 mutated live/once-live fields. This report supersedes that characterization for execution purposes.

---

## 6. Rollback path

- The step-2 bundle `familios-backup-local-<stamp>.json.gz` is a complete, format-2, restorable snapshot of tenant `local` at dry-run time (it contains every collection incl. `evolution`, `agent_versions`, `skill_versions`, plus `audit.jsonl`).
- To roll back a botched execution: copy the bundle into `server/.data/backups/`, rename to the `familios-backup-YYYY-MM-DD.json.gz` pattern `readBackup()` accepts, then `restoreBackup(name)` (atomic `importTenant` per tenant), and **restart the server** so all collections reload. Alternatively call `engine.importTenant("local", bundle.tenants.local.files)` directly.
- **Re-take a fresh backup immediately before real execution** (this dry-run backup will be stale by then).

---

**NO MUTATION HAS BEEN PERFORMED. Awaiting user approval.**
