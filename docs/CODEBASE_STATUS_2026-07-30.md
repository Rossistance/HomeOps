# FamiliOS — Full Codebase Status, 2026-07-30

**Method:** five parallel deep-read explorations (run pipeline · policy/agents · tenancy/identity · clients/tests/deploy · channels/integrations), plus first-hand verification of every Severity-1 finding, plus external state from GitHub, Render, and Expo. Not header-skimming — full files, cited by `path:line`.

**Baseline:** HEAD `ba6ab45`, `main`, 203 commits, Rossistance/HomeOps. 1,019 server tests across 130 files + 48 mobile unit tests, 0 failures. Web and mobile typechecks clean. Expo build 67 == HEAD. Render `homeops-ai` (starter, 1 GB disk) + `familios-browser-runtime` (free).

**Headline:** the engineering substrate is stronger than the commercialization plan assumed — per-tenant SQLite with physically separate databases, a well-tested approval policy engine, account deletion, a 21-day trial with a working RevenueCat webhook. **But multi-tenancy is complete at the data layer and incomplete at the operational layer**, and there is one cross-tenant data-exposure hole that must close before a single stranger signs up.

---

> ## ✅ WEEK 1 SHIPPED — commit `18640b3`, pushed to `main` 2026-07-30
>
> All four Week-1 items are implemented, tested, and deployed. **1014 server tests, 0 failures (24 new).** Web + mobile typecheck clean; `npm run build` clean; live webhook path and A2P raw-HTML verified against a running server.
>
> | Item | Status | Where |
> |---|---|---|
> | 1.1 Cross-tenant backup exposure | **fixed** — per-tenant `backups/<householdId>/`, slice-only legacy restore, operator-gated legacy surface, snapshots purged on household deletion | `server/backup.mjs`, `server/index.mjs`, `server/test/backup-tenant-isolation.test.mjs` (10 tests) |
> | 1.2 Kill switch → approval bypass | **fixed** — `BLOCKED` is now a hard step failure + audit; `reachesOutside()` narrows the reach test so local writes still work; `execResolved` gained the internal-tool check | `server/policy.mjs`, `server/engine.mjs`, `server/test/policy-resolution.test.mjs` (+5 tests) |
> | 1.5 Seeded consent | **fixed** — both seeds (server *and* the web copy that feeds `migrateContactMethodsToServer`) ship unverified / Pending | `server/seed.mjs`, `src/data/seed.ts`, `server/test/contact-methods.test.mjs` |
> | 3.1 STOP/HELP | **fixed** — keywords handled before any model, whole-message matched, audited, working for opted-out/unverified senders; START only *restores* a verified consent; `"Opted Out"` is a real state and renders coral | `server/sms.mjs`, `server/test/sms-keywords.test.mjs` (11 tests) |
>
> **Two extras found and fixed while in there:** the web's client-side seed also shipped pre-consented contacts (and migration would have pushed them back to the server, re-opening 1.5); and the boot-time backup tick now runs 60 s later, unref'd, because exporting every tenant while the process was still opening those same SQLite files made the concurrent suite flaky on Windows.
>
> **One vocabulary change worth knowing:** all three layers that can refuse for the kill switch now say the same sentence — *"External actions are paused by the household kill switch."* The `policy.mjs` reason was reworded to match `notify.mjs` and `execResolved` rather than weakening the existing `notify-contact-delivery` assertion.
>
> **Twilio consequence:** the campaign's claim *"users opt out by replying STOP… HELP returns help text"* is now true of the code. That removes an independent rejection cause; the entity classification (§3.2 — EIN + Low-Volume Standard, plus toll-free in parallel) is still the primary blocker and is not a code change.

> ## ✅ WEEK 2 SHIPPED — commit `f22277d`, pushed to `main` 2026-07-30
>
> The three items that made a signed-up household non-functional. **1025 server tests, 0 failures (11 new).** Typechecks clean.
>
> | Item | Status | Note |
> |---|---|---|
> | 1.3 OAuth tenant context | **fixed** — state moved to the `_system` tenant (same reason sessions live there: at callback time the household is unknown); account + vault tokens written inside `runWithTenant(st.householdId)`; failed-callback audits filed with the household that started the flow | `store.mjs`, `index.mjs` |
> | 1.4 Transactional email | **fixed** — new `server/mailer.mjs`, dependency-free HTTPS through `safeFetch` (so it's *inside* the egress choke point). Recovery mail is platform-first and deliberately **not** behind the household kill switch. Signup sends a real confirmation over a GET link that renders a page. Household email falls back to the platform sender instead of refusing, audited as a distinct transport. `/api/health` reports `mail.readiness` | `mailer.mjs`, `notify.mjs`, `index.mjs` |
> | 2.1 Platform AI key | **fixed** — `bootstrapAIFromEnv(householdId)` now runs once per household at boot *and* at signup, so a family created between restarts isn't waiting for a deploy. Idempotent: a household that chose its own key or a local Ollama keeps it | `ai.mjs`, `index.mjs` |
>
> **Also:** seed records stamp the tenant they're written into rather than the literal `"local"` — harmless today, but several readers still carry a legacy `|| householdId === "local"` clause that treats such a record as shared. And `render.yaml` gained `RESEND_API_KEY`, `FAMILIOS_MAIL_FROM`, and `HOMEOPS_OPERATOR_EMAILS` — the last was set on the service by hand but missing from the blueprint, so a rebuild would have dropped the operator console and, since Week 1, the only route to the legacy backup bundles.
>
> **⚠️ One deployment action required:** set `RESEND_API_KEY` and `FAMILIOS_MAIL_FROM` (a verified domain) in the Render dashboard. Until then `/api/health` reports `mail.readiness: "not_configured"` and account recovery still has no wire — the code is ready, the credential isn't.
>
> **2.2 per-tenant seeding — also done**, in a follow-up within the same push. `ensureSystemSkills(householdId)` uses the **resident household as the template** rather than duplicating 150 lines of inline definitions into a second code path: one source of truth, and a new household provably gets what this deployment actually ships. Filtered to `system: true` + `skl_` ids so a family's own authored skills never cross a tenant boundary, idempotent by id, and non-fatal. Stated trade-off: editing the resident household's system skills changes what new households inherit — intended for a self-hosted deployment tuning its own catalogue, and better than a second hard-coded list that drifts silently.

> ## ✅ WEEK 3a SHIPPED — commit `0292ffe`, pushed to `main` 2026-07-30
>
> **1033 server tests, 0 failures (6 new).** Typechecks + build clean; app boots with no console errors.
>
> | Item | Status |
> |---|---|
> | 5.1 `run.goal` never set | **fixed** — `startRun` stores it; chat routes pass the message; `runAgent` passes its goal (where the title is the agent's *name*). Kept separate from `title`; trimmed to 2000; honest `null` when there is no user sentence. |
> | 5.4 Chat runs always `household` visibility | **fixed** — inherited from the conversation. A nest conversation deliberately resolves to household: `startRun` only knows personal vs household, and under-notifying an approval is the worse error. |
> | 5.3 Repair path bypassed `orchestrate` | **fixed** — inherits the original run's `agentId`, `skillId`, `via`, `goal`, `visibility`. Without an agentId the engine's whole policy block was skipped *and* `notify_contact` hard-refused, so a "successful" repair still couldn't deliver. |
> | 5.6 Web ignored server `phase` events | **fixed** — wired with a phase lock so the token heuristic can't flicker the label back mid-search. Also deleted the `EventSource` that fired a real GET at the stream endpoint on every chat turn before aborting itself. |
>
> **Remaining in Week 3: WP-A household autonomy presets** (§Severity 4). Unchanged estimate **5–8 days**, because the dial has to land on a repaired control surface — the PIN asymmetry, the decorative web `autoAllow` editor, the four inert dials, and the `duplicate`/`rollback` policy laundering. Half-landing it would ship another toggle that looks like it works, which is the exact defect class this document tracks.

---

## SEVERITY 1 — Fix before any stranger has an account

### 1.1 Cross-tenant backup exposure *(the most serious finding here)*

`backup.mjs:20-43` `createBackup()` bundles **every tenant** into one `.gz` in a shared `DATA_DIR/backups`. The routes at `index.mjs:1492-1514` require only `minRole: "Owner"` — and **every signed-up stranger is Owner of their own household**.

Consequences, all reachable today by any registered user:
- `GET /api/backups` — enumerate every backup
- `GET /api/backups/:name` — **download every other family's complete data**
- `POST /api/backups/restore` — **overwrite every tenant**

This defeats the entire isolation story that `tenant-isolation.test.mjs` and `identity.test.mjs:57` otherwise prove correct. The per-tenant DB work is real; this route reaches around it.

**Fix:** scope backup creation and read to `currentTenant()`; gate restore behind operator authority (`HOMEOPS_OPERATOR_EMAILS`), never household Owner. Add a route-level test asserting household B cannot list or fetch A's bundle. Also: deleted households persist in shared bundles for 30 days with no purge (`backup.mjs:104-113`) — a GDPR/Apple-deletion contradiction.

### 1.2 The kill switch inverts into an approval bypass

`policy.mjs:60-63` returns `BLOCKED` when `externalActionsEnabled === false`. But `decide()` sets `requiresApproval: false` for every non-`NEEDS_APPROVAL` verdict (`policy.mjs:55`), and `engine.mjs:671` reads **only** `decision.requiresApproval`. `BLOCKED` is never imported into `engine.mjs`.

Two of three `BLOCKED` paths are pre-caught by `isToolStepAllowed` (`engine.mjs:637`). The kill-switch path is not. `execResolved`'s own check (`engine.mjs:318`) covers `kind:"provider"` only — `kind:"internal"` has none.

**Net effect: turning the household kill switch ON removes the approval gate from `homeops.update_agent` and `homeops.create_approval`.** Both are `requiresApproval: true` by default; with external actions disabled they execute unapproved. A safety control that makes the product less safe.

**Fix:** have `engine.mjs` honor `decision.decision === BLOCKED` as a hard step failure, and add the internal-kind kill-switch check in `execResolved`. `policy-resolution.test.mjs:101,109` already asserts the resolver returns `household.kill_switch` — the resolver is right; the consumer ignores it.

### 1.3 OAuth connect is broken for every signed-up household

The callback at `index.mjs:662-714` never calls `gate()`, so it runs with no tenant context → `currentTenant()` falls back to `RESIDENT_TENANT`. State was written into `hh_*` at `index.mjs:4503`, so `takeOAuthState` reads `"local"` and yields `invalid_state`. Even on success, `upsertAccount` → `putAccount` writes `accounts.json` into the **resident** DB while stamping `householdId: hh_*`.

**No stranger household can connect Google, Microsoft, Slack, or anything else.** This cascades into 1.4.

**Fix:** carry the household in the OAuth `state` payload and wrap the callback in `runWithTenant` before `takeOAuthState`.

### 1.4 No email transport — recovery is undeliverable

`notify.mjs:245-270` sends email **exclusively** through `gmail.send` on the household's own connected Google account; `notify.mjs:173` says so outright ("the only email transport this deployment has"). No SMTP, Resend, SendGrid, or nodemailer anywhere in the repo.

So for a new household: no Google connection (and per 1.3, it cannot make one) → `needsSetup:"google"` → **password reset, email verification, and recovery codes are undeliverable to the exact users those flows exist for.** The reset flow itself is well-built and enumeration-safe (`identity.mjs:69-134`, 12 tests) — it just has no wire.

Email verification is worse than missing: `identity.mjs:37` mints a `verifyToken`, signup returns `{sent:false, reason:"no_email_channel_yet"}`, and nothing enforces verification.

**Fix:** add one transactional email provider (Resend is ~40 lines and has a free tier) as a platform-level channel, independent of household OAuth. This is a prerequisite for paid signup — you cannot sell to someone who can't reset their password.

**⚠️ Related, and it changes earlier advice:** `HOMEOPS_BOOTSTRAP_PIN` is safe to remove *because you set your own `ownerPinHash`* — but until 1.4 lands there is **no email path back into your own account** if you lose that PIN. Remove the env var, and set a second Owner with a known-good credential first.

### 1.5 Seeded fake contacts are pre-verified and pre-opted-in

`seed.mjs:80-84` seeds five contact methods, four with `verified: true, optInStatus: "Opted In"` — `alex@harper.example`, `morgan@harper.example`, `(555) 010-2244`, `(555) 018-7700`. These satisfy **every** fail-closed gate in `notify.mjs:122-130` and `sms.mjs:47`.

On a seeded install with Google connected, `notify_contact` to `ct-alex-email` attempts a **real Gmail send to a reserved-TLD address**. Seed data should never be born consented.

---

## SEVERITY 2 — Blocks paid multi-tenant launch

| # | Finding | Where | Impact |
|---|---|---|---|
| 2.1 | **New households get no AI provider.** `bootstrapAIFromEnv` runs at boot with no tenant, so deployment keys configure only `"local"` | `ai.mjs:119-138`, `index.mjs:5348` | A paying family cannot use the assistant until they paste their own API key. **Fatal for the product as sold.** Needs a platform key with per-tenant metering. |
| 2.2 | **New households get zero seeded content** — no agents, skills, playbooks, contact methods | `seedDefaults()` at `index.mjs:5346`; `seed.mjs` stamps `"local"` throughout | Empty product on first run. Only the default agent self-heals (`orchestrator.mjs:64-100`, which admits this in a comment). |
| 2.3 | **Billing is server-complete, client-absent** | `store.mjs:331-363`, `index.mjs:750-781`, `planGate` at `:488-492` on 6 AI routes | No `react-native-purchases`, no paywall, no restore, and **neither client reads `/api/plan` or handles a 402**. Today the server will refuse and the UI will show an unhandled error. |
| 2.4 | **Inbound SMS and generic webhooks have no tenant context** | `index.mjs:723-748`, `:784-821` | Resolve only against `"local"`. Multi-tenant SMS is broken before it ships. |
| 2.5 | **Account-health sweep pinned to resident** — `forEachTenant(() => sweepAccountHealth({ householdId: CURRENT_TENANT }))` passes the constant every iteration | `index.mjs:5369` | Regresses the exact `needs_reconnect`-won't-clear bug `accounts.mjs:129-149` was written to fix. |
| 2.6 | **Connector poll jobs resident-only** (`CURRENT_TENANT`, not `currentTenant()`) | `index.mjs:548-550` | `rss-poll`/`weather-morning` and all `connector_event` triggers never fire for `hh_*`. Comment admits it. |
| 2.7 | One AES vault key for all tenants; shared memory SQLite with a `"default"` fallback bucket when the tag is missing | `store.mjs:80-89`, `memory-provider.mjs:58` | Weakens per-tenant secret isolation; a missing container tag cross-pollinates memory. |
| 2.8 | No per-household data export; no per-household rate limits | — | Apple/GDPR goodwill gap; one household can exhaust shared capacity. |
| 2.9 | No Sign in with Apple | — | Required once any third-party login exists; also no SIWA revocation on delete. |

---

## SEVERITY 3 — Twilio / SMS compliance (the active blocker)

**Rejection history** (from `homeops-twilio-a2p.md` + `outputs/twilio-a2p-support-ticket.md`): 30908 privacy-policy-unverifiable (root-caused to the React SPA serving `<div id="root">` to the non-JS vetting crawler, fixed with a static footer in `index.html`), **30912 personal/P2P with the reviewer note "SOLE PROP EIN ISSUE… not a true sole prop"**, then 30908 + 30886 (campaign description insufficient). Fourth attempt rejected; support ticket produced nothing.

### 3.1 There is no STOP/HELP handling — and the campaign claims there is

Verified first-hand: **zero occurrences** of `STOP`, `UNSTOP`, or `HELP` keyword handling anywhere in `server/*.mjs`. `handleInboundSms` (`sms.mjs:95-110`) resolves the sender and passes the body straight to `assistantRespond`.

Meanwhile the support ticket states: *"Users opt out by replying STOP or by removing the number in the application; HELP returns help text."* **That is not true of the code.** A reviewer who tests it finds it broken — an independent, self-inflicted rejection cause on top of the entity problem. Carrier opt-out handling is also a hard A2P requirement, and `connectors.mjs:547-549` shows the code already knows about 10DLC.

**Fix (an afternoon):** intercept `STOP`/`STOPALL`/`UNSUBSCRIBE`/`CANCEL`/`END`/`QUIT` before the assistant, set `optInStatus` to opted-out, reply with a confirmation; `START`/`UNSTOP` to re-subscribe; `HELP`/`INFO` to return program name + support contact + opt-out instructions. Then the claim becomes true.

### 3.2 The real rejection cause is entity classification, not wording

The reviewer said the sole-prop path is wrong for this. Three more rewrites won't move it.

**Recommended, in parallel:**
1. **Get an EIN** — free, instant, online from the IRS; no LLC required. Register a **Low-Volume Standard** brand instead of Sole Proprietor. This addresses the only objection actually stated.
2. **Submit toll-free verification** — 3–5 business days vs 10–15, separate review path, no sole-prop classification to fail. Rejections resubmitted within 7 days get priority review. Your own memory pre-committed to this exit: *"If rejected AGAIN with 30912, do NOT resubmit a 4th time."* That condition is met.
3. Fix 3.1 first either way — both paths ask about opt-out.

### 3.3 Other inbound-SMS gaps

- **No `planGate`** (`index.mjs:4661` guards chat, not the webhook) → **texting bypasses the paywall**
- **No `childAiGate`** → a Child View member with a verified phone can chat by text with the adult toggle off
- **No rate limit**; each text spends an unthrottled AI call
- **No `MessageSid` idempotency** → Twilio retries re-run the assistant and duplicate the message pair
- **Synchronous reply** — `assistantRespond` runs inside the webhook; exceed Twilio's timeout and the reply is lost *and* the retry fires

Correct by design: a text can never execute an approval-gated action (`sms.mjs:79-84`).

---

## SEVERITY 4 — The autonomy surface (why configuring it fights you)

The engine is genuinely good — `policy.mjs` resolves one effective policy with household → agent → capability precedence, tightening always honored, relaxing bounded by `isHighStakes()`, and every verdict names its rule. `policy-resolution.test.mjs` has 17 cases weighted toward the real threat model (a generated agent writing its own capability into its own `autoAllow`). Keep all of it.

The **control surface** around it is broken in five places:

1. **The most powerful switch has the weakest gate.** `requireHouseholdPin` appears at exactly three sites — its definition (`index.mjs:188`), the risk-override write (`:3788`), and dangerous settings (`:4560`) — and **nowhere in `/api/agents`**. So `unattended.includeHighRisk` ("emails, texts and payments go out without asking") needs only an Adult Admin session, while re-classing one tool demands the PIN.
2. **The web risk-override card cannot save on any household with a PIN.** `src/connectors/api.ts:943` posts no `pin`; `requireHouseholdPin` returns `pin_required` whenever `ownerPinHash` exists → 403 shown as a generic "Couldn't save." Mobile passes the PIN and works.
3. **The web `autoAllow`/`alwaysApprove` editor is still decorative** — the exact complaint `policy.mjs:6-9` quotes as fixed. `updateAgent` (`useStore.ts:1226`) is a local IndexedDB commit that never reaches the server; and the values written are *prose* and *step titles*, while `policy.mjs:94` tests `includes(cap.id)` against ids like `gmail.send`. Fails safe, but the toggle does nothing.
4. **Four more inert dials:** `agent.safetyLimits` (rendered with a green shield reading "Asks before any action that leaves the household" — read by zero policy code), `skill.approval_policy.gates`, `skill.risk_level`, `skill.memory_policy`.
5. **`duplicateAgent` copies `unattended` verbatim** including `setBy`/`setByRole` (laundered Owner attribution onto an Adult Member's copy); **`rollbackAgent` re-grants `includeHighRisk` without re-sanitizing.** And `runsUnattended` (`agents.mjs:337`) computes over *connected* capabilities only, so mobile shows a green "runs unattended" bolt for a helper whose send tool merely isn't wired yet.

**This is the recurring defect class, clustered in the worst place.** The UX-review memory tracks "a success signal that never reads the outcome it reports" at 7 sightings; items 2–5 add roughly five more, all in the permission surface — the one area where a false impression isn't cosmetic.

### WP-A revised — Household Autonomy Presets

**Do the repair first; the dial is the easy half.**

1. Close the PIN asymmetry — make the household preset *the* PIN-gated write, and have per-helper `unattended` inherit from it.
2. Fix or delete the decorative controls. A capability-id picker for `autoAllow`/`alwaysApprove` (neither UI has one), a real `patchAgent` from web, and `safetyLimits` wired or removed. Deleting is legitimate — an honest absence beats a false promise.
3. Re-stamp `approvalPolicy` on duplicate and re-sanitize on rollback.
4. **Then** the three-level dial — **Cautious / Balanced (new default) / Trusted** — with new-helper inheritance and a single bulk write. Every creation path currently starts at `{autoAllow: [], alwaysApprove: []}` or bare `{}`; no household default is inherited anywhere, which is exactly why chat-built helpers arrive gated.

**Estimate: 5–8 days** (was 2–4 for the dial alone).

---

## SEVERITY 5 — Assistant quality (why it underperforms its architecture)

1. **`run.goal` is never set.** `engine.mjs:243` and `:592` both read `run.goal ?? run.plan?.title`, but `startRun`'s record (`:455-476`) has no `goal` field and nothing patches one. **The user's actual request text never reaches any step-level LLM call** — a model-generated plan *title* stands in for what the family asked. This is probably the single highest-leverage quality fix in the codebase, and it's a few lines.
2. **Registered user functions are executable but unplannable.** `toolCatalog` (`planner.mjs:120-160`) omits them, and `normalizePlan:348` nulls any unknown `toolId`. A household can author, test, promote, and allow-list a function and the assistant will never reach it — the whole `functions.mjs` surface (7 types, 11 states) is chat-unreachable.
3. **The repair path bypasses `orchestrate`.** `assistant-runs.mjs:433` calls `startRun` directly with no `agentId`, so `homeops.notify_contact` hard-refuses `no_acting_agent` and the agent-policy block is skipped wholesale. This also falsifies the invariant asserted at `orchestrator.mjs:344-345`.
4. **Chat run visibility is always `household`** (`orchestrator.mjs:274-278`), so a plan born in a *personal* conversation fans its approvals to the whole family. `memory-capture.mjs:68` gets this right; the run path doesn't.
5. **Latency: 4 sequential model round-trips** before a result (plan → reasoning → 2× input fill), each of which can double via `providerChatWithFallback`. A lookup adds 5 **serial** HTTP fetches (`planner.mjs:722,731` — no `Promise.all`) plus a second compose call.
6. **No server-side instant acknowledgment.** The only pre-LLM output is `res.writeHead`. Web additionally **ignores the server's `phase` events** (`api.ts:835` handles only `progress`/`done`) — a capability that is tested end-to-end (`assistant-phase.test.mjs:57-91`) and shipped on mobile only, so web users see "Generating…" through the slowest part.
7. `plan_meal`'s prompt contract and `INTERNAL_INPUTS` disagree (`planner.mjs:480` vs `:26`) — `recipeUrl`/`instructions`/`servings`/`replace` can never be threaded though the handler reads them.
8. `write_memory` defaults `scope` to `"family"` (`internal-functions.mjs:257`), a fourth value no reader or UI chip matches.
9. `DELETE /api/memory/:id` (`index.mjs:3451`) lets an adult delete another member's *personal* memory, contradicting the GET rule documented at `:3431-3435`.
10. `emitters` Map (`engine.mjs:37`) is never pruned — one `EventEmitter` per run for process lifetime.

---

## SEVERITY 6 — Privacy claim, deploy hygiene, naming

### The egress claim in COMMERCIALIZATION_PLAN §7 is unsupportable as written

`net.mjs` itself is solid (`assertSafeUrl`, per-hop redirect re-validation, timeout, size cap). But **nine production call sites bypass it**, and the load-bearing one is `oauth.mjs:11 rawFetch` — the single funnel for **all** provider traffic including token exchange, refresh, health probes, and `notify.mjs:267`'s Gmail send. Also unguarded: `notify.mjs:55/77` (Expo push), `connectors.mjs:264/464` (weather), `:552` (Twilio), `memory-provider.mjs:248`, and `browser.mjs:127` — Chromium navigates on its own socket, with an in-page guard whose regex misses `172.16/12`, `100.64/10`, IPv6 ULA, and encoded IPs that `net.mjs` handles.

Two provider URLs are partly operator-controlled and unvalidated: `HOMEOPS_ALEXA_ENDPOINT` is concatenated into the request URL (`providers.mjs:402,412`) and `HOMEOPS_SDM_PROJECT_ID` is path-injected (`:191,204`).

**And no ledger is written anywhere.** `safeFetch` returns `host`/`ipCategory` (`net.mjs:123`) but persists nothing; only three call sites keep them.

**To make the claim true:** route `oauth.mjs rawFetch` and the Expo push calls through `safeFetch`, add an audit write inside `safeFetch`, and either proxy Playwright through a validating layer or narrow the claim to exclude browser automation. Until then, do not market an egress guarantee.

### Deploy

- **`HOMEOPS_OPERATOR_EMAILS` is missing from `render.yaml`** — the whole operator console (built, 4 tests, a mobile screen at `(settings)/operator.tsx`) 404s in production. *Note: prior session notes say this was set on the service by hand; it is absent from the committed blueprint, so any service rebuild loses it.*
- No search keys in the blueprint (`BRAVE_SEARCH_API_KEY`/`TAVILY_API_KEY`/`OPENAI_API_KEY`) → `web.mjs:225` gates on `anyKey`, so the assistant's "searching" phase has nothing to search with.
- **Root `eas.json` and root `app.json` are vestigial and hazardous** — no root `expo` dependency, no `env` blocks, no `ascAppId`. `eas build` from the repo root produces a localhost-pointed, unsubmittable build. Delete both.
- **`apps/mobile/.env.local` is committed** with a developer's LAN IP (`172.22.15.71`), and can override `.env` on another machine.
- `(settings)/ai.tsx:15` hardcodes `https://homeops-ai.onrender.com` with no env indirection.
- `engines` declares `>=22.13 <25`; the local machine runs **v25.8.2** — outside the declared range, against a `node:sqlite`-backed store. CI mobile job is on Node 20 while server/web are on 24.
- **`tests/topgun` (41 Playwright specs) is not in CI and not in `npm test`**, and `playwright.config.ts:37` sets `reuseExistingServer: true`. Effectively unenforced. There are also **zero web-client unit tests** — 3,528 lines of `useStore.ts`, including `reconcile.ts`'s subtle drop-vs-preserve merge, verified only by `tsc`.
- `api.ts:810-811` fires a real `EventSource` GET at the stream endpoint on **every chat turn** and immediately aborts it.
- CSRF is opt-in per call (`mutation: true`) rather than derived from HTTP method — a forgotten flag ships an unprotected mutation.

### The rename is not a find-and-replace

User-facing rename is **complete** (zero capital-`HomeOps` in `src/`; `brand.ts` is a proper single source). All 33 remaining hits are structural, and four categories require data migration or coordinated re-auth: the IndexedDB name (`storage/db.ts:16-20`), the SecureStore key `homeops_token`, the **`homeops.*` tool-id namespace** (persisted inside saved skills/functions/agents in every tenant DB — highest risk), and the Render service URL (renaming invalidates every registered OAuth redirect URI). **Recommendation: leave every internal identifier alone. Rename only what a human reads.** That work is done.

---

## What is genuinely strong — do not disturb it

- **Per-tenant SQLite, physically separate.** One DB per household at `DATA_DIR/tenants/<id>/household.db` with its own audit log and blobs (`tenant-db.mjs:53-99`). Corruption is quarantined, not clobbered; legacy JSON swept once with originals preserved under `.migrated/`. The measured spike (`spike-report.json`) chose Node's built-in `node:sqlite` over libSQL/Turso because an async driver "would force an async refactor of every store call site" — **point reads 5.948 ms → 0.031 ms (~190×)**, RMW ~20×. *This supersedes the plan's Turso recommendation, and the reasoning is better than the plan's.*
- **Isolation is tested at both layers** — engine invariants in `tenant-isolation.test.mjs`, and route-level in `identity.test.mjs:57` ("THE isolation invariant": a known task id returns 404 for the neighbor), `sync-rev.test.mjs:105` (SSE never leaks another household's write), `nests.test.mjs:196`, `loop-isolation.test.mjs:20-29`.
- **A CI job that boots a live server on the default data dir, runs the whole suite beside it, and requires `server/.data` byte-identical afterward via sha256 diff.** That guardrail was earned by a real incident (ISS-001) and is better than most commercial projects have.
- **Account deletion meets Apple 5.1.1(v)** — password re-verified, Owner deletion physically drops the tenant DB, identities and sessions purged, tombstone written, mobile UI wired (`index.mjs:1463-1489`, `identity.test.mjs:129`).
- **Approval binding is rigorous** — `consumeApproval` (`store.mjs:607-625`) fails closed on eight conditions including an input-hash match and a re-check that the decider *still* holds an approving role.
- **Honest degradation throughout** — `places.mjs:38-41` reports live busy-ness and wait time as *unavailable* rather than inventing them; `planner.mjs:564-591` emits an explicit `memoryDisclosure` when memory is degraded; `file-understanding.mjs:46-58` returns `null` rather than `""` on a missed PDF scrape; reminder dedupe stamps *before* the push.
- **Trigger scheduling is correct** — wall-clock anchors re-resolved from the household timezone on every fire (no DST slip, no drift), state advanced *before* the fire so an overlapping tick can't double-fire, fairness caps of 10/tick and 3/household, skipped triggers deferred rather than dropped.
- **`false-success-regression.test.mjs` is the largest test file in the repo (26 KB).** The name tells you what pain produced it, and it is the right response to that pain.

---

## Recommended order of work

**Week 1 — close the holes that make a stranger signup unsafe.**
1.1 backup scoping · 1.2 kill-switch bypass · 1.5 seeded consent · 3.1 STOP/HELP (unblocks Twilio too)

**Week 2 — make a stranger signup *function*.**
1.3 OAuth tenant context · 1.4 transactional email · 2.1 platform AI key with per-tenant metering · 2.2 per-tenant seeding

**Week 3 — the felt product.**
5.1 `run.goal` (hours, large payoff) · web `phase` events · WP-A repair + presets · 5.3 repair-path `agentId` · 5.4 run visibility

**Week 4 — sell it.**
2.3 paywall client (RevenueCat SDK, restore, 402 handling) · reconcile the server-owned 21-day trial with App Store Connect · 2.4 SMS tenant context + `planGate` + idempotency

**In parallel, not blocking:** EIN → Low-Volume Standard brand, and toll-free verification.

**Two process notes.** You are at **100% of this month's EAS build credits** (builds 52→67 in four days, now pay-as-you-go) — batch to one build per verified bundle rather than per commit. And set `aiDailyCallBudget`: the meter at `store.mjs:325-329` counts correctly and **never caps**, because nothing can set it (no route, no UI). It's a billing hook, not the COGS guardrail the plan assumed.
