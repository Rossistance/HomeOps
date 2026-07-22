# WP-005 — Agent-Package Migration Dry-Run Report

**Run:** run-20260721-054151 · **Date:** 2026-07-22 · **Analyst:** WP-005 s4 Migration Dry-Run
**Scope decision:** DEC-018 / ISS-013 — consolidate the resident family's fragmented helper
configuration into coherent packaged agents.
**Resident tenant:** `local` (owner `m-owner` "Ross"). **Mode:** READ-ONLY on resident data.

---

## Headline

- **57 resident fragments** enumerated live via the server HTTP API →
  **14 proposed packages** (limit is 20; **6 headroom**).
- Fragment breakdown (live, reconciled — see note): **20 agents, 14 skills, 4 functions,
  3 triggers, 16 playbooks**.
- **Dispositions by action:** `keep` 14 agents · `merge-into` 4 agents · `attach` 13 skills +
  4 functions · `becomes-instructions` 16 playbooks · `attach-trigger (retarget)` 2 triggers ·
  `keep` 1 trigger · `archive` 3 (2 agents + 1 skill).
- **What CHANGES (at real apply):** package metadata (`packageId`, `packageVersion`) is *added*;
  4 helper/duplicate agents are absorbed into a named survivor and set **Archived**; 2 Gmail
  triggers are **retargeted** to the survivor; 3 TG-* test remnants are **Archived**.
- **What does NOT change:** no fragment is deleted; all 13 real skills stay listed and invocable;
  every trigger keeps a valid target (zero orphans); no names are rewritten; no resident agent
  instructions are edited by the metadata pass. Playbook recipes are folded into anchor
  instructions **only** at the guarded in-process apply, and their source rows are retained.
- **Copy verification (disposable tenant, real `--apply`): ALL FOUR INVARIANTS PASS.**

> **Count reconciliation vs. audit EV-031.** The audit estimated ~18 agents / ~51-54 fragments.
> Live data shows **20 agents**. The delta is expected drift: WP-008b reverted one Gmail agent's
> instructions (its skill reference is now dangling — see below), and the "6 TG- test agents
> swept" left **2 TG-WP003 agents + 1 TG skill still present**. This migration archives those 3
> remnants rather than assuming they were removed. Two agents carry **dangling skillIds**
> (`agt_b805…`→`skl_269f…`, `agt_dcc2…`→`skl_09f7…`) that no longer resolve in the skill catalog
> — a direct artifact of the revert/sweep; the migration drops those dead references when
> consolidating (the survivor is attached to the *real* surviving Gmail skill).

---

## Method & safety

- Resident data read **only** through the live server API (GET only): owner session minted via
  `POST /api/session {actorId:"m-owner"}` (dev mode) with `Origin` + `x-homeops-bearer:1`.
  **No `household.db` / `-wal` / `-shm` file was ever opened by this process.**
- The working COPY is a **disposable tenant** `hh_074ad8b47949` created via `POST /api/signup`
  and seeded through normal API creates (same names, instructions, statuses, skill attachments,
  and trigger targets as the resident). The real `--apply` path was exercised there — never
  against `local`.
- **Zero POST/PATCH/DELETE was issued against the resident tenant.**

**Server mechanism finding (load-bearing for apply).** `server/agents.mjs`:
`createAgent`/`replaceAgent` run every body through `normalizeAgent`, which **whitelists** fields
and would silently drop additive keys. But `partialUpdateAgent` (the PATCH path) spreads
`{...existing, ...patch}` and does **not** normalize — so `packageId` / `packageVersion` /
`mergedInto` **round-trip through PATCH**. The migration therefore uses **PATCH exclusively** for
additive metadata; POST/PUT would strip it. Agents support a first-class `"Archived"` status
(`AGENT_STATUSES`), and skills honor an additive `archived:true` — this is how "archive-not-delete"
is realized. Playbooks expose only GET/POST/DELETE (no PATCH), so their "becomes-instructions"
disposition is realized by folding recipe text into the anchor agent's instructions during the
in-process apply, never by mutating or deleting the playbook.

---

## Per-record disposition table

| # | kind | fragment id | name | → package | action | rationale | reversibility |
|---|------|-------------|------|-----------|--------|-----------|---------------|
| 1 | agent | ag-briefing | Family Briefing Agent | ag-briefing | keep | package anchor (briefing domain) | clear packageId/Version |
| 2 | agent | agt_efea34b42f799e760fa3 | TG-WP003 Approval Agent | (archived) | archive | TG-* mission test remnant; hidden, retained | PATCH status→prior |
| 3 | agent | agt_3be3fc72465558cffb96 | TG-WP003 Read Agent | (archived) | archive | TG-* mission test remnant; hidden, retained | PATCH status→prior |
| 4 | agent | agt_household | Household Assistant | agt_household | keep | package anchor (general/events/system) | clear packageId/Version |
| 5 | agent | agt_b805192d4c2a6fd95513 | Gmail Promotional Cleanup Agent | agt_dcc2… | merge-into | duplicate; skl ref dangling; folds to survivor | un-archive + detach |
| 6 | agent | agt_morning_status | Morning Status Helper | ag-briefing | merge-into | functional helper absorbed into Briefing pkg | un-archive + detach moved skill |
| 7 | agent | agt_meal_planner | Meal Planner & Sign-Off | ag-meal | merge-into | functional helper absorbed into Meal pkg | un-archive + detach moved skill |
| 8 | agent | agt_dcc2d655ed11a996a7cf | Gmail Marketing Triage Agent | agt_dcc2… | keep | **Gmail survivor** (richest tools: 17 allowedToolIds) | clear packageId/Version |
| 9 | agent | ag-school | School & Daycare Agent | ag-school | keep | package anchor | clear packageId/Version |
| 10 | agent | agt_60e014b43520495dab4e | Gmail Promotional Cleanup Agent | agt_dcc2… | merge-into | duplicate; real Gmail skill folds to survivor | un-archive + detach |
| 11 | agent | ag-inbox | Inbox Helper Agent | ag-inbox | keep | package anchor | clear packageId/Version |
| 12 | agent | ag-gift | Gift & Birthday Agent | ag-gift | keep | package anchor | clear packageId/Version |
| 13 | agent | ag-pet | Pet Care Agent | ag-pet | keep | package anchor | clear packageId/Version |
| 14 | agent | ag-document | Document Organizer Agent | ag-document | keep | package anchor | clear packageId/Version |
| 15 | agent | ag-caregiving | Caregiving Coordinator | ag-caregiving | keep | package anchor | clear packageId/Version |
| 16 | agent | ag-home | Home Maintenance Agent | ag-home | keep | package anchor | clear packageId/Version |
| 17 | agent | ag-medical | Medical Appointment Agent | ag-medical | keep | package anchor | clear packageId/Version |
| 18 | agent | ag-travel | Travel Planner Agent | ag-travel | keep | package anchor | clear packageId/Version |
| 19 | agent | ag-meal | Meal & Grocery Agent | ag-meal | keep | package anchor | clear packageId/Version |
| 20 | agent | ag-bill | Bill & Receipt Agent | ag-bill | keep | package anchor | clear packageId/Version |
| 21 | skill | skl_942596c1e410b0a82c22 | TG-WP003 approval park | (archived) | archive | TG-* test skill; hidden, retained | PATCH archived:false |
| 22 | skill | skl_uc22_internal_system_sync | Internal System Sync | agt_household | attach | domain-routed; stays invocable | clear packageId tag |
| 23 | skill | skl_uc21_meal_planner_signoff | Multi-Channel Meal Planner & Sign-Off | ag-meal | attach | follows merged host (meal_planner)→survivor pkg | clear packageId tag |
| 24 | skill | skl_uc20_chore_doc_linker | Chore Manager & Document Linker | ag-document | attach | domain-routed; stays invocable | clear packageId tag |
| 25 | skill | skl_uc19_event_coordinator | Event Coordinator & Logistics Assigner | agt_household | attach | domain-routed; stays invocable | clear packageId tag |
| 26 | skill | skl_uc18_memory_scrapbooker | Digital Memory Scrapbooker | ag-gift | attach | domain-routed; stays invocable | clear packageId tag |
| 27 | skill | skl_uc17_recipe_extractor | Smart Recipe Extractor | ag-meal | attach | domain-routed; stays invocable | clear packageId tag |
| 28 | skill | skl_uc14_morning_status_text | Morning Status Text | ag-briefing | attach | follows merged host (morning_status)→Briefing pkg | clear packageId tag |
| 29 | skill | skl_uc12_climate_nightmode | Smart Climate Night-Mode | ag-home | attach | domain-routed; stays invocable | clear packageId tag |
| 30 | skill | skl_uc01_school_correspondence | School Correspondence Organizer | ag-school | attach | domain-routed; stays invocable | clear packageId tag |
| 31 | skill | skl_a70df415109a6d601558 | Daily Morning Briefing Delivery | ag-briefing | attach | trigger trg_bd15 target; stays invocable | clear packageId tag |
| 32 | skill | skl_cf7b28f7bf4dcd8534ef | Gmail Promotional Email Social Tag Cleanup | agt_dcc2… | attach | follows merged host (agt_60e0)→Gmail survivor pkg | clear packageId tag |
| 33 | skill | skl_morning_brief | Morning Family Briefing | agt_household | attach | already used by Household Assistant | clear packageId tag |
| 34 | skill | skl_0aecdd6d1d1a3cdfc549 | Gmail Promo/SalesTriage (copy) | agt_dcc2… | attach | domain-routed to Gmail survivor pkg | clear packageId tag |
| 35 | function | fn_fb428f44ff98924e5aeb | HomeOps inbox message/update creation | ag-home* | attach (ref) | capability referenced by package(s); retained | reference-only |
| 36 | function | fn_b31c6afd28ad67d38766 | HomeOps inbox send/post | ag-home* | attach (ref) | capability referenced by package(s); retained | reference-only |
| 37 | function | fn_gmail_recent | Recent inbox digest | ag-inbox | attach (ref) | capability referenced by package(s); retained | reference-only |
| 38 | function | fn_note_to_memory | Note to family memory | ag-gift* | attach (ref) | capability referenced by package(s); retained | reference-only |
| 39 | playbook | pb-birthday-party-planning | Birthday Party Planning | ag-gift | becomes-instructions | recipe folded into pkg instructions; source kept | revert anchor instructions |
| 40 | playbook | pb-caregiver-update | Caregiver Update | ag-caregiving | becomes-instructions | recipe folded; source kept | revert anchor instructions |
| 41 | playbook | pb-daily-family-briefing | Daily Family Briefing | ag-briefing | becomes-instructions | recipe folded; source kept | revert anchor instructions |
| 42 | playbook | pb-document-renewal-tracking | Document Renewal Tracking | ag-document | becomes-instructions | recipe folded; source kept | revert anchor instructions |
| 43 | playbook | pb-emergency-document-packet | Emergency Document Packet | ag-document | becomes-instructions | recipe folded; source kept | revert anchor instructions |
| 44 | playbook | pb-grocery-list-from-messages | Grocery List From Messages | ag-meal | becomes-instructions | recipe folded; source kept | revert anchor instructions |
| 45 | playbook | pb-home-repair-quote-comparison | Home Repair Quote Comparison | ag-home | becomes-instructions | recipe folded; source kept | revert anchor instructions |
| 46 | playbook | pb-medical-appointment-prep | Medical Appointment Prep | ag-medical | becomes-instructions | recipe folded; source kept | revert anchor instructions |
| 47 | playbook | pb-monthly-budget-review | Monthly Household Budget Review | ag-bill | becomes-instructions | recipe folded; source kept | revert anchor instructions |
| 48 | playbook | pb-pet-care-routine | Pet Care Routine | ag-pet | becomes-instructions | recipe folded; source kept | revert anchor instructions |
| 49 | playbook | pb-receipt-processing | Receipt Processing | ag-bill | becomes-instructions | recipe folded; source kept | revert anchor instructions |
| 50 | playbook | pb-school-email-triage | School Email Triage | ag-school | becomes-instructions | recipe folded; source kept | revert anchor instructions |
| 51 | playbook | pb_school_form | School form turnaround | ag-school | becomes-instructions | recipe folded; source kept | revert anchor instructions |
| 52 | playbook | pb_weekly_reset | Sunday weekly reset | agt_household | becomes-instructions | recipe folded; source kept | revert anchor instructions |
| 53 | playbook | pb-trip-planning | Trip Planning | ag-travel | becomes-instructions | recipe folded; source kept | revert anchor instructions |
| 54 | playbook | pb-weekly-family-planning | Weekly Family Planning | ag-briefing | becomes-instructions | recipe folded; source kept | revert anchor instructions |
| 55 | trigger | trg_bd15dd4bfe848e6e8dcd | Send daily morning briefing at 7 AM | →skl_a70df41 (Briefing pkg) | keep | skill target unchanged; resolves | restore prior target |
| 56 | trigger | trg_ae688f96236650ed8da4 | Manual Gmail Promotional Cleanup Run | →agt_dcc2 (survivor) | attach-trigger | retarget agt_60e0→survivor (zero orphan) | restore prior target |
| 57 | trigger | trg_12e57c5f669edba6c741 | Manual Gmail Promotional Cleanup Run | →agt_dcc2 (survivor) | attach-trigger | retarget agt_b805→survivor (zero orphan) | restore prior target |

\* Functions are shared capabilities referenced (not moved/mutated) by the noted primary package;
they remain globally available to any package's allow-list.

---

## Package roster (14 ≤ 20)

| package (anchor id) | name | absorbs | skills attached | triggers | folded playbooks |
|---------------------|------|---------|-----------------|----------|------------------|
| ag-briefing | Family Briefing | agt_morning_status | morning_brief*, Daily Morning Briefing Delivery, Morning Status Text | trg_bd15 (7 AM recurring) | daily-family-briefing, weekly-family-planning |
| agt_household | Household Assistant | — | Morning Family Briefing, Internal System Sync, Event Coordinator | — | weekly_reset |
| agt_dcc2… | Gmail Marketing Triage **(survivor)** | agt_b805, agt_60e0 | Gmail Promo Social-Tag Cleanup, Gmail Promo/SalesTriage (copy) | trg_ae688, trg_12e57 (retargeted) | — |
| ag-school | School & Daycare | — | School Correspondence Organizer | — | school-email-triage, school_form |
| ag-inbox | Inbox Helper | — | — (fn_gmail_recent ref) | — | — |
| ag-gift | Gift & Birthday | — | Digital Memory Scrapbooker | — | birthday-party-planning |
| ag-pet | Pet Care | — | — | — | pet-care-routine |
| ag-document | Document Organizer | — | Chore Manager & Document Linker | — | document-renewal-tracking, emergency-document-packet |
| ag-caregiving | Caregiving Coordinator | — | — | — | caregiver-update |
| ag-home | Home Maintenance | — | Smart Climate Night-Mode | — | home-repair-quote-comparison |
| ag-medical | Medical Appointment | — | — | — | medical-appointment-prep |
| ag-travel | Travel Planner | — | — | — | trip-planning |
| ag-meal | Meal & Grocery | agt_meal_planner | Meal Planner & Sign-Off, Smart Recipe Extractor | — | grocery-list-from-messages |
| ag-bill | Bill & Receipt | — | — | — | monthly-budget-review, receipt-processing |

*Archived (not a package, retained for audit):* `agt_efea…` & `agt_3be3…` (TG agents),
`skl_942596…` (TG skill).

---

## Zero-orphan & skill-invocability proof (from the COPY run)

The disposable tenant `hh_074ad8b47949` was seeded to match the resident, then the migration
script was run in real `--apply` mode. Verbatim script output:

```
[migrate] APPLY on tenant "hh_074ad8b47949" — backup first ...
[migrate] backup created: familios-backup-2026-07-22.json.gz
[migrate] applied 39/39 actions. Backup: familios-backup-2026-07-22.json.gz

[migrate] verifying post-apply invariants ...
  [PASS] package count <= 20  (14 packages)
  [PASS] zero orphaned triggers  (3 triggers, 0 orphans)
  [PASS] all real skills invocable  (13/13 skills attached)
  [PASS] nothing deleted (all fragments retained)  (53 rows / 53 fragments)

[migrate] DONE. Rollback with: POST /api/backups/restore { name: "familios-backup-2026-07-22.json.gz" }
```

**Independent post-apply recheck** (separate read of the mutated copy, not the script's own asserts):

```
SURVIVOR agt_dcc2: status=Draft pkgVer=1 packageId=agt_dcc2d655ed11a996a7cf skillIds=["skl_3a32…"]  (real Gmail skill folded in)
ARCHIVED agents: agt_efea…(tg), agt_3be3…(tg), agt_b805…(→agt_dcc2), agt_morning_status(→ag-briefing),
                 agt_meal_planner(→ag-meal), agt_60e0…(→agt_dcc2)          [6 archived, 0 deleted]
ag-briefing skillIds=["skl_96d0…"]   (Morning Status Text moved from merged helper)
ag-meal     skillIds=["skl_8aab…"]   (Meal Planner & Sign-Off moved from merged helper)
SKILLS listed=14  archived=1 → "TG-WP003 approval park"     (13 real skills still listed/invocable)
TRIGGERS:  trg_…→agent agt_dcc2 · trg_…→agent agt_dcc2 · trg_…→skill skl_13eb72 (briefing delivery)
ORPHAN TRIGGERS (independent recheck): 0
```

**End-to-end skill smoke** — invoking the briefing-delivery skill (a trigger target) on the copy
after migration:

```
POST /api/skills/skl_13eb72…/run  →  { run: { id: run_388a88…, status: "queued" } }   error=none
```

The skill resolved and produced a run — confirming skills remain invocable end-to-end post-apply.
(No external provider was contacted; the run queues through the normal runtime.)

**`--apply` guard proof** (refuses unless both conditions hold):

```
--apply, no HOMEOPS_MIGRATION_CONFIRM   → FATAL: --apply refuses unless env HOMEOPS_MIGRATION_CONFIRM=yes
--apply, no --tenant                    → FATAL: --apply refuses without an explicit --tenant <householdId>
--apply, no --token                     → FATAL: missing --token
```

---

## Migration script

**Path:** `D:\FamiliOS\FamiliOS\server\scripts\migrate-agent-packages.mjs`

- **Transport:** live server HTTP API only (`--base-url`, `--token`, `--csrf`, `--origin`).
  Never opens a SQLite file. Reads via GET; writes via PATCH.
- **Modes:**
  - `--dry-run` (**default**): enumerate, print the full mapping + would-do actions, **mutate nothing**.
  - `--apply`: **guarded** — refuses unless `--tenant <householdId>` is passed **and**
    `HOMEOPS_MIGRATION_CONFIRM=yes`, and requires `--csrf`.
- **Apply semantics:** backup-first (`POST /api/backups/run`) → additive package metadata via PATCH
  (`packageId`, `packageVersion`) → skill re-attachment onto survivors/anchors → trigger retargeting
  → archive-not-delete for retired fragments. Deterministic mapping (embedded merge rules +
  domain routing) so it produces the identical plan on the resident and on any faithful copy.
- **Self-verifying:** re-runs the four invariants after apply and prints the rollback command.

---

## Exact apply procedure for the resident tenant (`local`) — run only after user approval

1. **Fresh owner session (dev):**
   `POST /api/session {actorId:"m-owner"}` with `Origin: http://localhost:5173` + `x-homeops-bearer:1`
   → capture `token` and `csrf`.
2. **Dry-run once more against live resident** (read-only, sanity):
   `node server/scripts/migrate-agent-packages.mjs --token <TOKEN>`
   Confirm `57 → 14`, all four invariants PASS.
3. **Backup + apply (guarded):**
   ```
   HOMEOPS_MIGRATION_CONFIRM=yes \
   node server/scripts/migrate-agent-packages.mjs --apply --tenant local \
        --token <TOKEN> --csrf <CSRF>
   ```
   The script takes a full server backup **before** any write and prints its name.
4. **Post-checks (script auto-asserts; also verify in UI):** package count ≤ 20; 0 orphan triggers;
   13 skills still listed; 6 fragments Archived (2 TG agents, 2 Gmail dups, 2 merged helpers) +
   1 TG skill Archived; nothing deleted.
5. **Note — additive metadata via API PATCH is confirmed to persist** (partialUpdateAgent /
   partialUpdateSkill spread unknown keys). Playbook→instructions folding is the one step that
   runs in-process at apply time (no playbook PATCH route); if the WP later adds a `packageVersion`
   field to `normalizeAgent`, POST/PUT paths will also carry it, but PATCH already suffices.

## Rollback path

Every apply is backup-first. To fully revert:
```
POST /api/backups/restore { "name": "<familios-backup-YYYY-MM-DD.json.gz printed by the script>" }
```
This restores the pre-migration tenant snapshot (agents, skills, triggers, playbooks, audit log).
Per-record reversibility is also listed in the disposition table (un-archive, detach moved skills,
restore prior trigger targets, clear packageId/packageVersion) for surgical partial rollback.

---

## Blockers / open items for the apply owner

- **Dangling skill references** on `agt_b805…` (`skl_269f…`) and `agt_dcc2…` (`skl_09f7…`) are dead
  today (WP-008b revert / TG sweep artifact). The migration drops them and attaches the survivor to
  the real Gmail skill — but confirm the survivor's instructions/tool policy are the intended ones
  before apply (survivor `agt_dcc2` is currently **Draft** with 17 allowedToolIds).
- **Functions** are treated as shared references (not seeded into the copy; 4 on resident). If the WP
  wants functions explicitly bound to package allow-lists, add an `allowedFunctionIds` PATCH pass —
  trivially additive, not required for zero-orphan/invocability.
- **Playbook folding** is in-process at apply; the script does not mutate playbooks. If a per-playbook
  `packageId` tag is desired, a `PATCH /api/playbooks/:id` route must be added first (owned by the
  index.mjs sibling — hand off as a diff, do not edit here).

---

**NO RESIDENT MUTATION HAS BEEN PERFORMED. Awaiting user approval.**
