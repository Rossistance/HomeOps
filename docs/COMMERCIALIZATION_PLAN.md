# FamiliOS Commercialization Plan — Multi-Tenant SaaS + Private Local-AI Desktop

**Date:** 2026-07-09 · **Status:** Draft for team review · **Author:** Ross + Claude (deep-research + codebase audit)

> **Data honesty note (updated 2026-07-10 after a verification re-run).** The research pipeline was re-run to verify its claims. The adversarial verification pass **failed a second time** — first on a session rate limit, then on a monthly API spend limit — so **zero claims are independently verified.** What the re-run *did* produce is useful anyway: a second, independent extraction pass over the same primary sources reproduced the same headline figures (trial-length conversion, hard-paywall multiple, the 17.3% / 4.6% base rates, Small Business Program terms, the Dec 2025 Ninth Circuit ruling), and sharpened several. **Two independent extractions agreeing is corroboration, not verification** — it rules out one-off transcription error, not source error. Treat every percentage below as *twice-extracted from a named primary source, never adversarially checked*. Before any of this goes in front of investors or a team as fact, open the URLs in Appendix A and read the numbers yourself; it is about an hour of work.
>
> Confidence tiers used below: **[A] authoritative** (Anthropic pricing docs, Apple developer docs — read directly); **[B] corroborated** (same figure extracted twice from a named primary source); **[C] single-pass** (one extraction, or a search snippet). Codebase claims in §5 are **[A]** — read from source files in this repo, cited by path.

---

## 0. Executive summary

**The verdict, candidly:** This is buildable, the unit economics work, and you have one genuinely defensible differentiator — but the binding constraint is distribution, not engineering. The realistic base case is a profitable niche product ($500–$2,500 MRR at month 12), not a salary replacement in year one. Only 17.3% of new subscription apps reach $1K MRR within two years and 4.6% reach $10K (RevenueCat 2026, unverified). Your odds are meaningfully better than the base rate because (a) the product already exists and works, (b) family apps have high switching costs once a household is onboarded, and (c) **"your family's AI that never leaves your house" is a story no incumbent can tell** — Cozi, Skylight, FamilyWall are cloud-only organizers, and the AI entrants (Ohai, Milo) are cloud-only by design.

**The offering in one sentence:** FamiliOS Plus — one subscription per household (up to 8 members), $9.99/mo or $69.99/yr, 21-day full-access free trial, hard paywall, which includes the hosted cloud service *and* the FamiliOS Desktop app with one-click embedded local AI ("Private Mode").

**The clean path:** Multi-tenant foundation (**3–6 wks** — revised down after a first-hand code audit found `householdId` already threaded through the domain model) → App Store launch on cloud AI (3–5 wks) → Desktop app with embedded local LLM (6–10 wks) → provable-privacy hardening. Revenue starts at step 2; the differentiator ships at step 3. Total: roughly **4–5 months** part-time to paid launch, 7–9 months to the full vision.

**Why the economics work:** Blended net revenue ≈ $6.30/household/mo after Apple's 15% Small Business rate. AI COGS with prompt caching and a Haiku-routine/Sonnet-planning router ≈ $0.75–$2.50/household/mo. Infra ≈ $0.10–$0.25/household/mo at 1K households. Gross margin ≈ 55–75%. Private Mode *improves* margin — inference moves to the customer's hardware.

---

## 1. The offering

### What a family buys

| | Cloud (default) | + FamiliOS Desktop "Private Mode" |
|---|---|---|
| Where it runs | Your hosted multi-tenant server | Their PC/Mac/home server |
| AI brain | Claude (Haiku/Sonnet router), platform key | Embedded local model (one-click install) — no Ollama/LM Studio setup |
| Who it's for | Everyone (zero setup) | Privacy-conscious families; the "techie dad" *and* the family that just clicks Install |
| Data story | Encrypted at rest, no ads, no data sale | **AI conversations & household data never leave the home** (see §7 for exact claims) |
| Mobile/web | Full apps | Web portal stays for changes away from home (per your vision); mobile pairs to the home node |

Both are the **same subscription**. Private Mode is not an upsell tier — it's the reason to choose FamiliOS over Cozi, and bundling it into one plan keeps the offer simple (your "don't overcomplicate" constraint) while making the privacy story a headline feature, not an add-on.

### Competitive positioning

| Competitor | Price | AI? | Local/private option | Notes |
|---|---|---|---|---|
| Cozi Gold | ~$39/yr | No | No | Free tier now limits calendar view to 30 days (search-sourced) — huge dissatisfied user base |
| FamilyWall Premium | ~$45–60/yr | No | No | Needs verification |
| Skylight (device+Plus) | ~$300 + ~$79/yr | Basic "Sidekick" | No | Proves families pay real money when friction is removed |
| Ohai.ai | ~$15/mo | Yes (cloud) | No | AI household assistant; validates AI price ceiling |
| Milo | ~$40/mo | Yes (cloud) | No | Premium AI family logistics |
| **FamiliOS Plus** | **$9.99/mo / $69.99/yr** | **Yes — agents, skills, automations, playbooks** | **Yes — unique** | Priced between organizers and AI concierges |

The wedge: organizers are cheap but dumb; AI assistants are smart but cloud-hungry and 1.5–4× your price. Nobody occupies "smart AND private AND reasonably priced."

---

## 2. Pricing, packaging, and the trial

### Recommendation

- **One plan: FamiliOS Plus** — $9.99/mo or $69.99/yr (annual = ~42% off, pre-selected on the paywall). Whole household, up to 8 member profiles.
- **Trial: 21 days, full access, all features, hard paywall after.** No permanent free tier beyond a read-only demo/tour.
- **Founding Family lifetime: $199, first 100–200 households** (web checkout only). Cashflow + evangelists + a common, credible move in the local-first community (Obsidian-style catalysts).
- Launch **US App Store first**; EU later (DMA/alternative terms add complexity you don't need yet).

### Why (grounded in the benchmark data — corroborated but unverified; see header note and Appendix A tiers)

- **Hard paywall, not freemium:** hard-paywall apps convert downloads→paid at a **10.7% median vs 2.1%** for freemium (5×), and earn ~$2.32/install in two weeks vs $0.27. A generous free tier for a solo dev is a support burden that converts at 2%. Give away the *trial*, not the product.
- **21 days, not 7:** trials of **17–32 days convert at 42.5% median vs 25.5%** for ≤4-day trials. A family needs 2–3 weekends to onboard a spouse, connect Google Calendar, and form the habit — the exact adoption arc long trials reward. (Counter-signal to watch: long trials show higher cancellation rates, 51% for 30-day vs 26% for 3-day — mitigate with day-3/day-10/day-18 activation emails and an in-app "your family's week, planned" moment early.)
- **$9.99/mo sits on the most common price point** in RevenueCat's dataset ($10/mo), and **higher-priced apps show ~$62 year-1 LTV vs ~$26 mid / ~$11 low** — under-pricing an AI product is the classic mistake. AI apps monetize ~41% better per payer but churn ~30% faster, so annual-first positioning matters: push the $69.99/yr plan hard.
- **Trial mechanics:** implement as a StoreKit auto-renewable subscription with an **introductory offer (free trial)** configured in App Store Connect, managed through RevenueCat. Auto-converts at trial end; Apple handles reminders. All features included in the trial — the AI agents *are* the conversion moment; gating them would be gating the demo.
- **Apple's cut:** enroll in the **Small Business Program → 15% commission** (you qualify: <$1M net proceeds). RevenueCat is free until well past your early scale, then ~1%.
- **Web checkout (Stripe):** since the April 2025 Epic v. Apple injunction, US apps may link out to web checkout; the **Dec 11, 2025 Ninth Circuit ruling restored Apple's right to charge a "reasonable commission" on link-outs, fee TBD on remand** — external links are commission-free *for now* but that window is closing, and RevenueCat's own A/B data shows web checkout converts worse than native IAP. **Decision: IAP is primary; add Stripe web checkout only for the desktop-first/lifetime purchases where there's no iOS app in the loop.** Don't build your revenue plan on the legal gray zone.

---

## 3. Unit economics — costs in and out

### Per-household monthly (at ~1,000 paying households)

| Line | Amount | Basis |
|---|---|---|
| Blended gross revenue | ~$7.40 | 60% annual ($5.83/mo-equiv) / 40% monthly ($9.99) |
| Apple 15% + RevenueCat | −$1.10 | SBP rate; RC free tier then 1% |
| **Net revenue** | **~$6.30** | |
| Claude API (cloud households) | −$0.75 to −$2.50 | Haiku 4.5 $1/$5 per MTok for routine turns, Sonnet-class $3/$15 for planning; prompt-cache reads ~0.1×; Batch API 50% for nightly digests. ~200 interactions/household/mo, 4–6K tokens each, mostly cached |
| Infra share | −$0.10 to −$0.25 | Render service(s) + DB + email + push amortized |
| SMS (Twilio) | −$0.00 to −$0.40 | **Meter it**: cap included SMS/mo per household; push/email first |
| **Gross profit** | **~$3.50–$5.30 (55–75%)** | Private Mode households: AI line ≈ $0 → margin *rises* |

Heavy-user guardrail: implement a soft monthly AI budget per household (e.g., generous cap + "fair use") so a runaway automation can't invert a household's margin.

### Fixed costs (out of pocket)

| Item | Cost | When |
|---|---|---|
| Apple Developer Program | $99/yr | Now |
| LLC + basic legal (ToS/privacy policy templates) | $150–$800 one-time | Before charging money |
| Render (backend) + DB (Turso/Neon) | $25–$100/mo at launch; $150–$400/mo at 1K households | Ongoing |
| Windows code-signing (Azure Trusted Signing) + macOS notarization | ~$10/mo + $0 (in Apple dev fee) | Phase 3 |
| Domain, email (Resend/Postmark), Sentry | ~$30–$60/mo | Launch |
| Twilio A2P campaign (already provisioned) | ~$2/mo + usage | Ongoing |
| Marketing experiments (ASO tooling, small ads tests) | $0–$300/mo discretionary | Post-launch |

**Total cash to reach paid launch: roughly $1,500–$3,000** (excluding your time). Break-even on fixed costs at roughly **40–80 subscribed households**.

---

## 4. Realistic outcomes: forecast + likelihood of success

Base rates (RevenueCat 2026 — **[B]** corroborated, not verified): median app = **$72 MRR at 1 year**; middle 50% of all subscription apps = $16–$429/mo; top quartile ≥$429; top 10% ≥$2,574. Only **17.3%** reach $1K MRR within 2 years; **4.6%** reach $10K. >90% of downloaders churn within 30 days for most apps. Plan against these numbers, not against dreams.

### 12-month scenarios (from US App Store launch, with the privacy launch story executed)

| Metric @ month 12 | Conservative | Base | Strong |
|---|---|---|---|
| Cumulative installs | 2,000 | 6,000 | 20,000 |
| Install→trial (hard paywall, ~7.3% NA median) | 150 | 440 | 1,500 |
| Trial→paid (21-day, ~40%) | 60 | 175 | 600 |
| Retained subscribers (after churn ~5–7%/mo, annual-heavy) | ~45 | ~130 | ~450 |
| **MRR** | **~$300** | **~$850** | **~$3,000** |
| Percentile vs all subscription apps | ~top 30% | ~top 15% | ~top 7% |

Assumed monthly logo churn 5–7% blended (annual plans churn slower; AI apps churn faster — these offset). The Strong case requires a distribution event: a Show HN / r/selfhosted / r/LocalLLaMA launch of Private Mode that lands, plus press pickup of the "family AI that stays home" angle. That's the whole game.

### Likelihood assessment (candid)

- **Ship a working multi-tenant product + App Store approval:** ~90% — this is execution, and the codebase is in good shape (see §5).
- **Reach $500+ MRR within 12 months of launch:** ~50–60% with consistent niche marketing; ~25% without it.
- **Reach $2,500+ MRR (top decile) within 18 months:** ~20–30%, contingent on the Private Mode launch story landing in at least one large community.
- **Reach $10K+ MRR (salary territory) within 2 years:** ~5–10% (base rate 4.6%; your differentiator and existing product nudge it up, solo-dev distribution nudges it down).
- **Downside if it "fails":** you still own a production-grade product your family uses, a rare local-LLM shipping story, and a portfolio asset. The downside is bounded and useful — that asymmetry is the best argument for proceeding.

---

## 5. Engineering roadmap (dependency-ordered)

Grounded in the actual codebase: hand-rolled Node backend ([server/index.mjs](../server/index.mjs)) with a file-backed JSON store + AES-256-GCM secrets vault ([store.mjs](../server/store.mjs)), cookie/bearer sessions with CSRF + a 6-role model ([auth.mjs](../server/auth.mjs)), a first-party OAuth connector platform ([providers.mjs](../server/providers.mjs)), an AI provider registry **that already includes Ollama and LM Studio adapters with health probes** ([ai.mjs](../server/ai.mjs)), React/Vite PWA, Expo iOS app ([apps/mobile](../apps/mobile)), tests that boot a real server against `HOMEOPS_DATA_DIR`, Render deploy.

**Already tenant-friendly (deep-audit result — this is better than a generic assessment would assume):** the domain model **already carries `householdId` end-to-end** — runs, run steps, triggers, memories, audit entries, and connected accounts are all household-scoped records, sessions resolve `session.householdId` (defaulting to `"local"`), and OAuth accounts are additionally scoped to the *connecting actor* with ownership checks ([accounts.mjs](../server/accounts.mjs)). Add to that the role model, session/CSRF infra, secrets vault, `HOMEOPS_DATA_DIR` indirection, and the real-server test harness. **The actual single-tenant residue is narrow and nameable:** (a) the persistence layer — one global set of ~30 JSON files with scan-and-filter accessors; (b) `settings.json` is global — `aiActiveProvider` and `externalActionsEnabled` are read unscoped inside the engine; (c) the four background loops in [index.mjs](../server/index.mjs) (~L2478: boot-time `recoverRuns`, 60s `expireStaleRuns`, 10s trigger `tick`, connector poll + per-job timers) scan globally with no per-household error isolation or fairness; (d) in-process locks/idempotency keys aren't tenant-prefixed; (e) there is no self-serve *creation* of new households (today: one claim flow).

### Phase 0 — Decisions & setup (≈1 week) — no dependencies

- 0.1 Form the LLC; Apple Developer enrollment + Small Business Program; RevenueCat account.
- 0.2 Complete the FamiliOS rename's deferred items (bundle id, `homeops://` scheme, Render URL) **now** — cheaper before strangers have accounts.
- 0.3 **Tenancy architecture decision (gates Phase 1):** recommend **libSQL/Turso database-per-household**. Rationale: your store is literally a directory of files per household today — DB-per-tenant is the same mental model with real durability; isolation is physical (a query bug can't leak across families — a marketing-grade claim: "your family's data is one file"); idle households cost only storage; and the *same embedded libSQL file* runs inside the desktop app in Private Mode — one storage engine across cloud and desktop. Fallback if Turso's ops model feels risky after a 2-day spike: boring Postgres + `household_id` + row-level security. Do the spike, then commit.
- 0.4 Repo hygiene: move the legacy zips/`HomeOps_AI_..._Handoff` dirs out of the repo root; stale default model IDs in [ai.mjs](../server/ai.mjs) (`claude-3-5-haiku-latest`, `gpt-4o-mini`) → current IDs.

### Phase 1 — Multi-tenant foundation (≈3–6 weeks, revised **down** after the deep audit) — **blocks everything else**

*Why the estimate shrank: the domain layer already speaks `householdId` end-to-end. This is a persistence + globals + onboarding project, not a domain-model rewrite. Most call sites already pass a household or a session; the store's internals change beneath them.*

- 1.1 **Tenant-scoped persistence** *(blocks 1.2–1.6; ≈1.5–3 wks)*: swap the file-store internals for per-household DB (Turso/libSQL per §0.3 — one table per current JSON file; JSON-blob columns first, normalize later) behind the *same* accessor surface. Today's `"local"` default household becomes the first real migrated tenant (your own family — a genuine migration test). Tenant-prefix the in-process locks (`withLock("hh:"+id+":"+key)` in [store.mjs](../server/store.mjs)) and idempotency keys. Keep `HOMEOPS_DATA_DIR` semantics so the test harness becomes "one temp DB per test household."
- 1.2 **Un-globalize settings** *(depends 1.1; ≈2–4 days — surfaced by the audit)*: `settings.json` is global today, and [engine.mjs](../server/engine.mjs) reads `aiActiveProvider` and `externalActionsEnabled` unscoped inside the run executor (`activeAiProvider()`, `externalActionsEnabled()`). Every `getSettings()` call site needs a household. **This is the sneaky one** — miss it and family A's runs execute against family B's chosen AI provider and kill-switch. It's also the hook Private Mode needs: `aiActiveProvider` per household is exactly how a desktop household selects `familios-local`.
- 1.3 **Background loops: isolation & fairness** *(depends 1.1; ≈0.5–1 wk)*: the four loops at [index.mjs](../server/index.mjs) ~L2478 (boot-time `recoverRuns`, 60s `expireStaleRuns`, 10s trigger `tick`, connector-poll + per-job `setInterval` timers) already operate on household-tagged records, so they can keep scanning globally — but add per-household try/catch isolation (one family's failing automation must not stall the fleet's tick), a per-household concurrency cap, and the per-household AI-budget metering hook that §3's COGS guardrail depends on. `recoverRuns()` and the run leases (`LEASE_OWNER = process.pid`) also assume one process — revisit before running more than one web dyno.
- 1.4 **Identity & self-serve onboarding** *(depends 1.1; ≈1–2 wks)*: **household creation for strangers** (today only a claim flow exists) + email/password or passkeys + **Sign in with Apple** (required once any third-party login exists) on the existing session layer — it's already solid (httpOnly cookies, CSRF, origin allowlist, bearer tokens for mobile, 6 roles); don't buy Clerk, it adds per-MAU cost and weakens the privacy story. Add: email verification, password reset, household invites (extend `contact_methods`/`contact_verifications`), and the **full account-deletion flow** — Apple Guideline 5.1.1(v): in-app initiation, real deletion including the member's content embedded in shared household data, SIWA token revocation, and the "cancel your subscription first" notice.
- 1.5 **Billing & entitlements** *(depends 1.4; blocks 2.1 and 3.5; ≈1 wk)*: RevenueCat SDK in the Expo app; `familios_plus` entitlement; RC webhook → `household.plan` + grace/billing-retry states; server-side plan gate on all agent/AI routes.
- 1.6 **Integrations & ops** *(depends 1.1; ≈0.5–1 wk — shrunk: the audit found OAuth accounts already scoped per household **and** per connecting actor, with vault-isolated tokens and `getOwnedAccount` ownership checks in [accounts.mjs](../server/accounts.mjs))*: remaining work is Twilio per-household metering, per-household rate limits, backups + restore drill, per-household data export, Sentry, and a 500-household synthetic load test.
- **Exit criteria:** two strangers self-serve signup → invite family → connect Google → run agents, fully isolated; account deletion verified; `npm test` green on a multi-tenant harness. **Write the cross-tenant-isolation invariant tests first** — they are the safety net for the store swap, and they belong in the existing `server/test` harness alongside the security invariants.

### Phase 2 — App Store launch (≈3–5 weeks) — depends on Phase 1

- 2.1 Paywall + 21-day trial (App Store Connect intro offer; annual pre-selected; restore purchases) *(depends 1.5)*.
- 2.2 Compliance pass: privacy nutrition labels, hosted privacy policy + ToS, review notes with a demo household. **COPPA posture:** children exist as *parent-managed profiles*, not independent child accounts with logins — keeps you out of "child-directed service" territory and out of the Kids Category; revisit only if you later ship kid logins (then: verifiable parental consent).
- 2.3 Review-readiness polish on the Expo app: empty states, offline behavior, purchase restoration, no broken web-links.
- 2.4 **TestFlight beta: 20–50 real families for 4+ weeks** (recruit from r/selfhosted, local parent groups, friends). Fix the top-10 friction list. Then launch + ASO (target "family organizer AI", "private family assistant").

### Phase 3 — FamiliOS Desktop with embedded local AI (≈6–10 weeks) — depends on Phase 1; can start parallel to Phase 2 after 1.5

- 3.1 **Shell: Electron** *(blocks 3.2–3.5)*. The backend is dependency-light hand-rolled Node — it embeds in Electron's main process nearly verbatim, serving the existing web UI as the desktop UI. (Tauri is slimmer but needs a Node sidecar for your server — net-worse here.) electron-updater + Azure Trusted Signing (Win) + notarization (macOS).
- 3.2 **Embedded inference** *(blocks 3.3; depends 1.2)*: `node-llama-cpp` in-process, registered as a new provider `familios-local` in the existing `AI_PROVIDERS` registry ([ai.mjs](../server/ai.mjs)) — the UI, health probes, `providerReadiness()` states, and `providerChat()` call path you already built apply unchanged. Selecting it is a per-household `aiActiveProvider` write, which is why 1.2 gates this. **The quality lever: grammar-constrained generation** — `createGrammarForJsonSchema` forces every agent/skill/function tool call to be schema-valid JSON at the decoder level, which is what makes 4B–8B models *reliable* rather than merely possible. Keep Ollama/LM Studio adapters as BYO-runtime for enthusiasts. Do **not** bundle LM Studio (proprietary terms); bundling Ollama (MIT) is legal but embedding llama.cpp directly is cleaner and truly "nested inside" the app as you envisioned.
- 3.3 **One-click model install** *(depends 3.2)*: detect RAM/GPU → curated menu of **certified** models: default **Qwen3-4B-Instruct** (Apache-2.0, ~3GB, runs on 8GB machines), **Qwen3-8B** or **Phi-4-mini (MIT)** for 16GB+. Prefer Apache/MIT models — Llama's community license (attribution/naming) and Gemma's use-restriction flow-down add friction for a proprietary bundle. GGUF Q4_K_M download with resume + checksum. **Certification = your existing test harness:** run the playbook/skill/automation suite against each candidate model; a model ships only if it passes — this is how you keep the "guaranteed to operate agents, automations, skills, playbooks" promise honest.
- 3.4 **Hybrid mode first ("Private AI"):** cloud keeps doing sync/push/SMS, but all LLM inference for the household runs on the desktop node. This is ~80% of the privacy value for ~20% of the work of full local-only. Full local-only (mobile pairs to the home node over LAN, cloud optional) is Phase 4+.
- 3.5 **Licensing** *(depends 1.5)*: entitlement check with signed offline grace (~30 days) so Private Mode doesn't phone home constantly.
- **Honest constraint to design for:** a 4B model is *much* dumber than Claude. Mitigations: grammar constraints (3.2), a tool-router that exposes few tools per turn, simplified planner prompts per model tier, per-request "ask the cloud instead" escape hatch (opt-in, clearly marked), and UI copy that sets expectations ("Private Mode uses a smaller brain — great for routines, slower on open-ended asks").

### Phase 4 — Provable privacy (≈4–6 weeks, then ongoing) — depends on Phase 3

- **Egress ledger:** all outbound traffic already funnels through [net.mjs](../server/net.mjs)'s `safeFetch` — one choke point. Log every outbound host to a user-visible panel; in Private AI mode the ledger *demonstrates* zero AI egress. This is cheap and no competitor has it.
- Publish a precise privacy claims page (see §7), consider open-sourcing the desktop shell (not the whole product) for verifiability, third-party audit when revenue supports it (~$10–30K — defer).

### Dependency chain (critical path)

```
0.3 DB decision
      └→ 1.1 tenant store ──┬→ 1.2 un-globalize settings ─┐
                            ├→ 1.3 loop isolation ────────┤
                            └→ 1.6 integrations/ops       │
                               1.4 identity + onboarding ─┴→ 1.5 billing → 2.x App Store launch   ($ starts, ~month 4-6)
                                                                    │
                                                                    ├→ 3.1 Electron → 3.2 local inference → 3.3 model installer → 3.4 hybrid Private AI → launch #2 (the story, ~month 7-9)
                                                                    └→ 3.5 offline licensing                                              └→ 4.x provable privacy (egress ledger)
```
Two things to notice. **1.2 (un-globalize settings) is on the critical path for Private Mode**, not just for tenancy — per-household `aiActiveProvider` is precisely how a desktop household selects the local model. And **Phase 3 forks off after 1.5**, so desktop work can start the moment billing exists; it does not wait for App Store approval.

---

## 6. Why the local-LLM bet is credible (and its caveats)

- **Precedent that the business model works:** Home Assistant/Nabu Casa monetizes local-first software with an optional cloud subscription at ~$6.50/mo (~$65/yr) and sustains a real company. Obsidian, Bitwarden, Proton all show privacy-positioned consumers pay recurring money. You're applying a proven model to a category (family organization) where it doesn't yet exist.
- **The tech is ready:** node-llama-cpp gives you Metal/CUDA/Vulkan-accelerated inference inside Node with JSON-schema-grammar enforcement; Qwen3-class 4B–8B models at Q4 fit in 3–6GB and handle constrained tool-calling credibly in 2026. Your app's AI surface is *already* provider-pluggable.
- **Caveats, plainly:** (1) Small-model agents will disappoint users who expect Claude-quality open-ended reasoning — scope Private Mode marketing to routines/automations/planning, not magic. (2) Supporting inference on heterogeneous consumer hardware is a real support tax — the hardware-gated curated menu and certification harness exist to contain it. (3) Windows GPU diversity is the worst of it — ship CPU-first defaults that always work, GPU acceleration as detected. (4) This phase is 6–10 weeks you're not spending on growth; it's justified because it *is* the growth story.

---

## 7. Privacy claims: what you can truthfully say, and proving it

| Mode | Truthful claim | Never claim |
|---|---|---|
| Cloud | "Encrypted in transit and at rest; secrets in an AES-256-GCM vault; we never sell or train on your data; full export & deletion." | "Private" in the local sense |
| Private AI (hybrid) | "**Your family's AI runs entirely on your computer. Conversations and AI processing never leave your home.** Sync, reminders and SMS use our cloud." | "No data ever leaves your devices" (sync does) |
| Full local (later) | "No family data leaves your home network. The only outbound call is an anonymous license check (viewable in the ledger, cached 30 days)." | "Zero network activity" |

Provability ladder (cheap → expensive): egress ledger UI → published claims page with exact data-flow diagrams → open-source desktop shell → reproducible builds statement → third-party audit. Do the first two at Phase 4 launch; they're differentiating on day one because they're *checkable* (any user can run Little Snitch/Wireshark and confirm — invite them to).

---

## 8. Top risks

1. **Distribution (dominant risk):** a great product with no channel yields the $72/mo median outcome. Mitigation: the Private Mode launch is engineered *as* the distribution event; build in public from Phase 1; TestFlight families become the referral seed.
2. **Small-model quality** → §6 mitigations; certify before shipping any model.
3. **Solo-dev support load:** families = weekend-morning support spikes. Mitigation: hard paywall (fewer, more-committed users), in-app self-serve diagnostics (you already build "truthful readiness" UX — extend it), status page.
4. **App Store review friction:** account deletion, SIWA, and paywall clarity are the usual rejection points — all explicitly in Phase 2.
5. **Apple external-payment rules in flux:** commission on link-outs returning (fee TBD on remand). Mitigation already chosen: IAP-primary.
6. **AI COGS tail risk:** one automation-happy household looping Sonnet calls. Mitigation: per-household budget + Batch API for scheduled work + Haiku-first routing.
7. **Burnout/bus factor:** 7–9 months of nights-and-weekends. Mitigation: revenue at month ~4–6 (Phase 2 ships before the desktop work), visible metrics, and a scope-frozen v1.

---

## 9. Next 30 / 60 / 90 days

- **Days 1–30:** Phase 0 complete (LLC, Apple + Small Business Program, RevenueCat, rename migration, DB spike + decision). Write the cross-tenant-isolation invariant tests. Start 1.1 tenant store. *Decision gate: Turso vs Postgres locked. Also: spend the hour verifying Appendix A's [B]/[C] figures before they harden into assumptions.*
- **Days 31–60:** Finish 1.1–1.5 (persistence, un-globalized settings, loop isolation, identity incl. SIWA + deletion, billing). *Gate: two isolated households self-served end-to-end on staging; isolation tests green.*
- **Days 61–90:** 1.6 + Phase 2 paywall/compliance; TestFlight beta opens with 20+ families; Phase 3.1 Electron shell can start in parallel. *Gate: beta retention — if <30% of beta families are weekly-active at week 4, fix engagement before launch. Marketing into a leaky bucket is wasted money.*

---

## Appendix A — Key benchmarks & sources, with confidence tiers

**[A] = read directly from an authoritative doc. [B] = the same figure extracted twice, independently, from a named primary source. [C] = single extraction or search snippet. Nothing here survived adversarial verification (see the header note).**

**RevenueCat, *State of Subscription Apps 2026*** (115K+ apps, ~$16B tracked revenue) — the load-bearing source for §2 and §4:
- **[B]** Trial-to-paid by trial length: ≤4 days **25.5%** median · 5–9 days **37.4%** · 17–32 days **42.5%** (~70% better than the shortest). *Run 2 added: top quartile of 17–32 day trials exceeds 59.4%.* North America median across apps 34.2%.
- **[B]** Hard paywall vs freemium, D35 download→paid: **10.7% vs 2.1%** (~5×).
- **[B]** Base rates: **17.3%** of new apps reach $1K monthly revenue within 2 years; **4.6%** reach $10K. *Run 2 corroborated both.*
- **[B]** Median **$72 MRR at 1 year**; middle 50% of all apps $16–$429/mo; top 10% $2,574+.
- **[C]** Revenue per install, hard paywall vs freemium: run 1 read **$2.32 vs $0.27 at ~2 weeks**; run 2 read **$3.09 vs $0.38 at day 60**. Different windows, same ~8× direction — *do not quote a single number here without opening the source.*
- **[C]** Price anchors — the two runs **disagree in detail**: run 1 said common points $5/wk, $10/mo, $30/yr with median annual $34.80 (up from $31.60); run 2 said median monthly rose $7→$8 and repeated $34.80 annual. Both support "$9.99/mo is at/above the common point; ~$70/yr is premium-but-defensible." Verify before quoting.
- **[C]** AI apps: +41% revenue per payer, ~30–36% worse retention. Y1 realized LTV by price tier: $62.19 high / $26.07 mid / $10.69 low. >90% of downloaders churn within 30 days. Download→trial: NA 7.3%, business category 8.9% (the ceiling). 78% of hard-paywall trials start in week 1. App Store involuntary churn = 14% of cancellations (vs 31% on Play). Top quartile grew MRR ≥80% YoY; bottom quartile shrank ≥33%.
- **[C]** Business of Apps: 3-day trials ~26% cancellation vs 30-day ~51% — *the counterweight to long trials; it is why §2 pairs the 21-day trial with day-3/10/18 activation nudges.*

**Apple** ([developer.apple.com](https://developer.apple.com/app-store/small-business-program/), [account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/)):
- **[B]** Small Business Program: 15% commission, eligibility ≤$1M USD **proceeds** (net, not gross) in the prior calendar year; new developers qualify. Crossing $1M mid-year moves you to standard rate **for subsequent sales only, not retroactively**; you re-qualify the year after dropping back below. EU alternative terms: 10%.
- **[B]** Guideline 5.1.1(v), in force since June 30, 2022: any app supporting account creation must offer **in-app-initiated account deletion**. Deactivation is insufficient. Must remove user-generated content shared with others; may not require a phone/email support flow; must notify users with active subscriptions to cancel first; must revoke Sign in with Apple tokens via the SIWA REST API.

**Epic v. Apple / external payments:**
- **[B]** April 2025 district-court injunction: US apps may link out to external checkout, zero commission, no Apple control over link design.
- **[B]** **December 11, 2025 — Ninth Circuit**: Apple *may* charge a reasonable commission on external-link purchases, partially reversing the injunction; anti-steering design limits restored (external links may not be more prominent than IAP). **Remanded — the fee is not yet set, so link-outs remain commission-free in the interim.** Apple's pre-injunction rate was 27%.
- **[C]** RevenueCat: web checkout converts worse than native IAP (their Dipsea A/B); they recommend hybrid, not replacement. Web-revenue adoption: 41% among top-revenue-tier apps vs 1.3% in the smallest tier. *This is why §2 chooses IAP-primary.*

**Claude API — [A], read from Anthropic's current pricing reference:** Haiku 4.5 **$1 / $5** per MTok (in/out); Sonnet 5 **$3 / $15** (intro $2/$10 through 2026-08-31); Opus 4.8 $5/$25. Prompt-cache reads ≈**0.1×** input; cache writes 1.25× (5-min TTL) or 2× (1-hr). Batch API **50%** off. These are the inputs to §3's $0.75–$2.50/household COGS band.

**[C] Search-phase only, needs confirmation before use:** Cozi Gold ~$39/yr and its May 2024 free-tier restriction to a 30-day calendar view; FamilyWall/Skylight/Ohai/Milo prices in §1; Nabu Casa $6.50/mo or $65/yr; Turso libSQL DB-per-tenant economics (no cold start, idle ≈ storage); `node-llama-cpp`'s `createGrammarForJsonSchema` + built-in function calling; Qwen3/Phi-4/Llama/Gemma license terms. **Model licenses in particular must be read in full before you ship a binary containing weights — that is a legal exposure, not a benchmark.**

## Appendix B — How this plan was produced, and what failed

**Research:** deep-research fan-out — 6 angles, 10 primary sources fetched, 50 claims extracted. Adversarial verification (3 skeptic votes per claim, 75 panels) was attempted **twice** and failed both times: first on a session rate limit, then on a monthly API spend limit. The second run's fetch/extract phases replayed from cache and re-extracted independently, which is where the [B] tier comes from. **Nothing was adversarially verified.** The workflow is resumable — `Workflow({scriptPath: …deep-research-wf_04d7dcf1-ccc.js, resumeFromRunId: "wf_04d7dcf1-ccc"})` — and completed agents replay free, so a third attempt after the spend limit resets costs only the verification panels.

**Codebase audit — [A], first-hand.** The Explore subagent died on the rate limit mid-task, so §5's findings come from direct reads: [store.mjs](../server/store.mjs) (file-backed JSON + AES-256-GCM vault, atomic writes, `withLock` promise-chain mutex, idempotency ledger), [auth.mjs](../server/auth.mjs) (origin allowlist, httpOnly cookie + bearer sessions, CSRF, 6 roles), [ai.mjs](../server/ai.mjs) (6-provider registry incl. Ollama + LM Studio, `providerReadiness` vocabulary, `providerChat`), [providers.mjs](../server/providers.mjs) (first-party OAuth connector platform, declarative tool manifests), [accounts.mjs](../server/accounts.mjs) (accounts scoped per household **and** per connecting actor), [engine.mjs](../server/engine.mjs) (durable run executor, approvals, leases, `recoverRuns`, auto-memory judge — reads `getSettings()` globally), [triggers.mjs](../server/triggers.mjs) (household-tagged triggers, `nextRunAt` persistence), [index.mjs](../server/index.mjs) (~2,470 lines; four background loops at ~L2478), `package.json`, and the 30-file `server/.data` inventory. Server total ≈ 564KB across 24 `.mjs` modules. **Not read:** `orchestrator.mjs`, `planner.mjs`, `skills.mjs`, `functions.mjs`, `connectors.mjs`, `notify.mjs`, the web client, and the Expo app — a Phase-0 estimate refinement should cover the planner and orchestrator, since those determine how much prompt surgery Private Mode's small models need (§6's main unknown).

**Capabilities used:** deep-research workflow; claude-api skill (pricing, [A]); all-in-one-skill lifecycle as the planning frame; direct file reads. **Skipped:** Explore agent (rate-limited), docx/pptx export (markdown chosen for repo versionability — say the word and I'll produce a formatted deck or PDF for the team), Notion/Linear/Figma MCPs (not authenticated in this session).

**Retrospective — worth fixing before the next research run:** (1) The deep-research workflow fans out 75 verification agents with no rate-limit backoff or partial-credit path; when the budget dies, *all* verification is lost even though extraction succeeded. It should stagger panels, degrade to 1 verifier per claim under pressure, and persist per-claim verdicts as they land. (2) A cheaper default would verify only the ~8 claims that actually move a decision (trial length, paywall type, price point, base rates, Apple's commission and deletion rules) rather than all 25. Both are worth encoding into the skill.

---

# ADDENDUM — 2026-07-10: status correction, blocker triage, and the "magic gap"

*Written after re-auditing the repo at its new location (`D:\FamiliOS\FamiliOS`) and after two real-world blockers surfaced: a 4×-rejected Twilio A2P 10DLC registration, and a decision to defer linking bank details to Apple. Everything above stands except the Phase 1 sizing, which was written against a stale snapshot.*

> **SUPERSEDED IN PART — see [CODEBASE_STATUS_2026-07-30.md](CODEBASE_STATUS_2026-07-30.md).** A five-agent full-code exploration on 2026-07-30 corrected three things in this document: (1) **§0.3's Turso/libSQL recommendation is obsolete** — a measured spike chose Node's built-in `node:sqlite` instead, because an async driver would force an async refactor of every store call site; per-tenant physically-separate SQLite is already shipped and tested. (2) **§7's egress-ledger privacy claim is unsupportable as written** — nine production call sites bypass `safeFetch`, including `oauth.mjs:11 rawFetch` which carries all provider traffic, and no ledger is written anywhere. Do not market an egress guarantee until that is fixed. (3) **Billing is not greenfield** — a 21-day trial, `getPlan`, a RevenueCat webhook, and `planGate` on six AI routes are all shipped server-side; only the client half is missing. The status document also identifies a cross-tenant backup exposure that must close before any stranger signs up.

## A1. The codebase has moved past this plan — Phase 1 is largely built

The roadmap in §5 assumed multi-tenancy was unstarted. It isn't. Modules that did not exist in the audited snapshot:

| Module | What it does | Plan item it closes |
|---|---|---|
| [tenant-context.mjs](../server/tenant-context.mjs) | `AsyncLocalStorage` carries `householdId` through the synchronous store accessors — request context filled by `gate()`, `runWithTenant()` for engine runs / trigger fires / boot loops, `RESIDENT_TENANT` fallback | **1.1**, the single hardest item (est. 1.5–3 wks) |
| [tenant-db.mjs](../server/tenant-db.mjs) + `server/spike/tenant-store-spike.mjs` | Per-tenant storage layer + the DB spike §0.3 called for | **0.3**, **1.1** |
| [policy.mjs](../server/policy.mjs) | One effective approval policy resolved in one pure function: household → agent → capability, tightening always honoured, relaxing bounded by `isHighStakes()`; every result names the rule that produced it | (not in the plan — see A3) |
| [identity.mjs](../server/identity.mjs), [pin.mjs](../server/pin.mjs) | Identity/auth surface beyond the original session layer | part of **1.4** |
| `recordAiUsage` / `aiBudgetExhausted` in [store.mjs](../server/store.mjs) | Per-household AI spend metering | the §3 COGS guardrail + **1.3** hook |
| `getSettings(householdId)` | Settings are now household-scoped | **1.2** — the "sneaky one" is already fixed |
| [assistant-runs.mjs](../server/assistant-runs.mjs) | Conversation-born runs report back into the thread; failed runs self-heal once, then offer to save the repaired plan as a reusable helper; `delivers` flag (not a name regex) decides what counts as delivered | (not in the plan — this is ahead of it) |
| [backup.mjs](../server/backup.mjs), [nests.mjs](../server/nests.mjs), [reminders.mjs](../server/reminders.mjs), [places.mjs](../server/places.mjs), [memory-capture.mjs](../server/memory-capture.mjs), [automation-preflight.mjs](../server/automation-preflight.mjs), [file-understanding.mjs](../server/file-understanding.mjs) | Product surface built since | — |

**Revised Phase 1: ~1–3 weeks, not 3–6.** What plausibly remains is self-serve household *creation* for strangers, the Apple-required account-deletion flow, billing/entitlements (1.5), and the cross-tenant isolation test suite. **Verify before planning against this** — run `npm test` and grep for `runWithTenant` coverage; I read module headers, not every call site.

## A2. Neither blocker is on the critical path

**Apple — you do not need a bank account yet.** The $99 Developer Program membership (paid by card) is all TestFlight needs. The **Paid Applications Agreement** — which requires bank and tax details — is required only to *sell*. So the whole validation sequence runs first: build → TestFlight → 20–50 real families → measure week-4 retention → *then* link banking and flip the paywall. That is months of unblocked runway, and it puts the money step after the evidence that the product retains, which is the right order anyway.

**Twilio — pivot to toll-free, and fix the one field that is probably killing you.** Per Twilio's own compliance docs: toll-free verification takes **3–5 business days** vs 10–15 for an A2P campaign, needs a simpler submission, and a rejected toll-free application **resubmitted within 7 days gets priority review**. For household-volume traffic the A2P throughput advantage is irrelevant. Then:

- **The prime suspect is the consent-as-condition trap.** Twilio's rule: *"If customers must opt in to messaging to complete a purchase or create an account, the registration **will be rejected**."* If the campaign describes opt-in as happening during member setup — where a phone number is required — that is an automatic reject, and it would be rejected identically on every resubmission. Which matches 4 denials with no useful support explanation.
- **The second suspect is the message-flow field** — Twilio names it the #1 campaign rejection cause. It needs four things: opt-in method description with no pre-checked boxes, message frequency ("up to N msgs/month"), the literal string "Message and data rates may apply," and a **publicly accessible** link to a screenshot of the opt-in UI (Drive/OneDrive set to anyone-with-link is explicitly fine). Also required: a privacy policy that states mobile data is **not** shared with third parties, and T&Cs with HELP/STOP in bold. No public URL shorteners.
- **Good news you may not realize you have:** [sms.mjs](../server/sms.mjs) `resolveSmsSender()` already requires a contact method that is `verified === true` **and** `optInStatus === "Opted In"`, backed by `contact_verifications.json`. That is a genuine, auditable double opt-in — exactly the evidence the campaign wants. The problem is almost certainly *describing* it, not *having* it. Screenshot that verification flow, host it publicly, and quote the exact consent copy in the message-flow field.
- If a brand (not campaign) rejection is in the mix: brand rejection means business name/EIN do not match tax records **exactly**. With the LLC formed, register a Standard brand on the EIN rather than Sole Proprietor.
- **WhatsApp does bypass A2P 10DLC** — but needs Meta Business Verification (weeks) plus pre-approved templates for anything outside the 24-hour service window. Not a shortcut.

## A3. The "magic gap": why competitors feel like *just text it and it does anything*

This is the important finding, and it is not an architecture problem.

**1. The channel is built, not missing.** [sms.mjs](../server/sms.mjs) implements `handleInboundSms({from, body})`; [index.mjs](../server/index.mjs) exposes a Twilio-signature-validated `POST /api/webhooks/sms`; inbound texts resolve to a verified member and land in the *same* durable conversation model the web and mobile chat use (`channel: "sms"`); there is a passing `server/test/sms-gateway.test.mjs`. **Two-way "text your assistant" is finished code waiting on a phone number.** That is a procurement blocker wearing the costume of a product gap.

**2. The defaults gate every useful action — and there is no preset to loosen them.** `sms.send` and `gmail.send` are `risk: "High"`, `delivers: true`, `requiresApproval: true`. `isHighStakes()` in [policy.mjs](../server/policy.mjs) means **no agent-level `autoAllow` can ever clear those gates** — by design, and correctly so. The only thing that can is a household-level `risk_override` with `skipApproval: true`. That mechanism exists, is audited, and works: the audit log shows it being toggled by hand on `gmail.modifyLabels`, `calendar.create`, `sms.send` on 2026-07-03/04, and the spike report counts **9** risk overrides in the store.

So the honest diagnosis: *the autonomy dial exists, it is per-tool, and it must be set nine-plus times by hand.* Nobody — including you — will do that per household. Competitors feel magical because their default is "act," with no gate at all. Yours is "ask," on everything that matters.

**The highest-leverage work package in this entire document is therefore not in the roadmap above:**

> **WP-A: Household Autonomy Presets.** One household-level setting with three named levels that writes the appropriate set of `risk_override` records in a single action:
> - **Cautious** — today's behavior; approve everything that sends, writes, or pays.
> - **Balanced (recommended default)** — auto-run reads, calendar adds, list/task/reminder writes, and in-household notifications. Still approve: outbound email/SMS to non-members, purchases, downloads, anything touching money or an outside party.
> - **Trusted** — auto-run everything except money and messages to people outside the household; report afterward instead of asking first.
>
> Ship **Balanced as the default for new households.** Keep the kill switch and `isHighStakes` boundary exactly as they are — this changes defaults and adds a preset writer, it does not weaken the policy engine. Surface it in onboarding as one question ("How much should Famili do on its own?") and echo the effective policy in plain words, which `policy.mjs` already returns via its `rule`/`reason` fields.
>
> **Estimated effort: 2–4 days.** It is the difference between "sophisticated but asks permission constantly" and "it just handles it."

**3. Perceived latency.** Plan → steps → tool calls is slower than a one-line reply. Fix with acknowledge-instantly, execute-async, report-in-thread — which `assistant-runs.mjs` already does for run results. Make the *acknowledgment* immediate and specific ("On it — adding that to Tuesday and texting Sarah") rather than silence until the run finishes.

**What the competitors don't have:** durable restart-recoverable runs, at-most-once side effects, an auditable approval policy with named rules, honest delivery reporting (`delivers` flag rather than a name-sniffing regex — the false-success class you already eliminated), per-household isolation, and a credible local-LLM privacy path. Those are the parts that are hard to build and hard to copy. "Feels magical" is a defaults-and-copy problem, and it is days of work, not months. Do not rebuild toward the competitors' architecture; change your defaults and keep the substrate.

## A4. Revised near-term sequence (nothing here needs Twilio or Apple)

1. **This week — WP-A autonomy presets** (2–4 days). Biggest felt improvement per hour spent, and it makes every demo better.
2. **This week — instant-acknowledgment copy** in the assistant loop (hours).
3. **Days 3–5 — toll-free verification submitted**, with the opt-in screenshot hosted publicly and the message-flow field written to the four-element spec. Keep the A2P campaign open in parallel; if it clears later, migrate.
4. **Weeks 2–3 — close the real Phase 1 remainder**: self-serve household creation, account deletion, cross-tenant isolation tests. Confirm what is actually left rather than trusting either estimate.
5. **Weeks 3–4 — TestFlight with real families** on the $99 membership. No banking, no paywall, no SMS dependency (push + in-app chat carry it).
6. **Then, and only then** — RevenueCat + Paid Applications Agreement + paywall, once week-4 retention says the product holds.

**On "losing ground daily":** the assistant-app land rush is real, but the apps shipping easy text interfaces are mostly thin wrappers with no durable execution, no family multi-user model, no approval semantics, and no privacy story — and every one of them sending US SMS hits the same A2P wall you are hitting. Ground is lost by shipping nothing for months, not by being four days behind on a toll-free number. Items 1 and 2 above are the ones that close the felt gap, and they are this week's work.
