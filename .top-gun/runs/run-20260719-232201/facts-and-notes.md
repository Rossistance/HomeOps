# Facts and Notes — Mission Handoff

- Run: run-20260719-232201
- Goal: Audit and implement real-user TestFlight feedback on the FamiliOS native mobile app (apps/mobile, ai.familios.app) - the surface the first run left out of scope
- Prepared by: top-gun (orchestrator), 2026-07-19

## Mission and boundaries

- Scope: `apps/mobile/` (Expo Router app, bundle ai.familios.app) plus the shared backend paths it calls (`server/*`), within repo `D:\FamiliOS\FamiliOS`. The web app (`src/`) is reference/comparison surface only — its Full-slate changes just shipped in run-20260719-073933 and must not be reworked here.
- Pipeline: audit → capability-matching → implementation of THIS run's recommended bundle. **User pre-selection is recorded**: when the menu exists, the recommended bundle is the selection — record it and proceed without pausing.
- Non-goals: App Store/TestFlight submission, EAS builds (billable, user-authorized only), store metadata, web-app rework.
- Authority: product source read-only until this run's selection gate; after the gate, local edits within the selected bundle only. No git mutations, no deploys, no external messaging. **Never mutate the production backend** (`https://homeops-ai.onrender.com` — live family data, baked into preview builds): all runtime work targets the LOCAL backend :8787. No EAS build/upload, no cloud-driver account creation. Same forbidden secret files as run 1 (`.env`, vault, the .p8/twilio files in D:\HomeOps if still present).
- Real-user data caution: the feedback names real testers (Melissa, Jeannie) and family details (children's names/ages in screenshots). Keep them inside the run workspace; never publish or externalize.

## Observed facts

- Seed evidence: `testflight-feedback-handoff/HANDOFF.md` (registered ART-001, snapshot) — 12 TestFlight submissions, 13 screenshots, builds 1.0.0(13)/(19), iPhone 14/15, iOS 26.5/26.5.2, two real testers. Its [OBSERVED] layer (verbatim notes + screenshot transcriptions) is field evidence; its [INFERRED/CANDIDATE] layer (TF-ISS-01..11, TF-WP-A..F, candidate files, severities) is hypothesis requiring code confirmation.
- All 13 screenshots already preserved locally at `audit/evidence/TF-SS-01.jpg .. TF-SS-13.jpg` (downloaded and JPEG-magic-verified 2026-07-19, before the ~2026-07-24 Apple URL expiry). Not yet visually inspected/indexed — that is the audit lead's first action.
- Mobile app structure: `apps/mobile/src/app/` route groups `(agents) (ask) (home) (library) (settings)`; Expo SDK 56 (per runtime-drivers.json); own CLAUDE.md at `apps/mobile/CLAUDE.md` (read it — repository instructions apply).
- Runtime driver probes (this session, 2026-07-19):
  - `playwright-web`: **use now** — v1.61.1, `tests/topgun/playwright.config.ts` present (projects web-chromium, web-webkit-iphone).
  - `appium-device-cloud`: **blocked** — probe output: missing `BROWSERSTACK_APP_ID`, `BROWSERSTACK_USERNAME`, `BROWSERSTACK_ACCESS_KEY`; unblock = user sets them per `tests/topgun/.env.topgun` / `docs/SETUP-CLOUD.md`. LT/APPIUM_REMOTE_URL also absent.
  - `appetize-sim`: **blocked** — `APPETIZE_API_TOKEN` and `APPETIZE_PUBLIC_KEY` absent; also requires a simulator build that has not been produced.
- Local stack healthy at handoff: backend :8787, Vite :5173, browser-runtime :9223 (all from `D:\FamiliOS\FamiliOS`, node v25.8.2).
- Run-1 outcomes relevant here (historical context, revalidate before relying): full slate WP-001..005 delivered in the worktree (uncommitted); `npm test` now safe beside the live backend (291/291); assistant/connector honesty principles implemented on web (`src/lib/ai.ts` local engine, provider_error pattern); server help/task/file/Google-push endpoints unchanged by run 1 except `/api/profiles` payload trim.
- Worktree at handoff: HEAD ffcfa33, uncommitted run-1 slate changes + user harness drift — all must be preserved untouched except within this run's eventual selected scope.

## Supported inferences

- The TestFlight feedback targets a different codebase (`apps/mobile`) than run 1 touched; adjacency is principle-level only (assistant honesty, sync fidelity) — reuse principles, not diffs (HANDOFF §2).
- TF-008 (task reassignment) and TF-012 (upload persistence) have a server-side truth component reachable through the LOCAL backend with two accounts / two attempts — full native rendering confirmation is blocked with the native drivers.
- Testers' devices ran builds 13 and 19; current `apps/mobile` source may already differ — every candidate must be confirmed against current source before it becomes an issue.

## Unknowns and open questions

- TF-012: did a second upload fail, or is a success-confirmation missing? (two-attempt repro against local backend + code trace).
- TF-008: does ownership fail server-side or only in client refetch/rendering? (two-account repro server-side + client code trace).
- Does the event model already support all-day/date-only representations unexposed by the mobile editor?
- Do builds 13 vs 19 differ on any reported path? (git history + current source).
- Exact server endpoints behind `apps/mobile/src/lib/api.ts` for help-assignment, upload, Google push.
- Can `apps/mobile` run in any locally-verifiable form (Expo web support?) — investigate honestly; do not force it.

## Authority and safety limits

- Runtime verification lanes: local backend API (two-account flows OK), web app for shared-logic comparison, playwright-web harness. Native iOS runtime evidence is BLOCKED (drivers above) — native-only findings stay code-traced with parity-risk labels; never claim native verification from web evidence (runtime-drivers routing precedence).
- Google-push verification: contract/mock level only against the local backend; never a live Google mutation.
- No SMS, no OAuth setup, no connector external side effects, no EAS/build/store actions.

## Capability inventory summary

- use now: playwright-web harness + Playwright MCP, local backend API, Read/Grep/Glob, python mission scripts, mem scripts, node/npm (v25.8.2 path), 13 preserved screenshots, HANDOFF seed, run-1 registers (historical).
- use if needed: chrome-devtools MCP; `npx expo` for a local dev-server/web attempt (no accounts, no builds).
- blocked: appium-device-cloud, appetize-sim (unblock conditions above — user-side).

## Artifact links

- ART-001: HANDOFF.md snapshot. Screenshots at `audit/evidence/TF-SS-01..13.jpg` (index into evidence ledger during audit).

## Next discriminating checks

1. Visually inspect + index all 13 screenshots against HANDOFF §4 transcriptions.
2. Read `apps/mobile/CLAUDE.md`; map the route groups and `lib/api.ts` endpoint surface.
3. Code-confirm each TF-ISS candidate against current source (files named in HANDOFF are hypotheses).
4. Two-account TF-008 repro on local backend; two-attempt TF-012 repro.
5. Trace event model for end-date/all-day/notes support and the Google-push payload builder.
