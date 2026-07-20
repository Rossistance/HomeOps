# Facts and Notes — Mission Handoff

- Run: run-20260720-072344
- Goal: Deliver the FamiliOS discovery 30-day priorities: (1) complete the HomeOps→FamiliOS rebrand, (2) full topgun E2E pass, (3) real-provider end-to-end loop demo, (4) migrate mobile plan dispatch to the durable server run engine
- Prepared by: top-gun (orchestrator), 2026-07-20

## Mission and boundaries

- Scope: repo `D:\FamiliOS\FamiliOS` (web `src/`, backend `server/`, mobile `apps/mobile/`, E2E `tests/topgun/`, deploy config `render.yaml`, docs/READMEs). Driven by the app-angel discovery report at `D:\FamiliOS\.app-angel\familios\01-discovery.md` (outside repo root — read-only input).
- Pipeline: audit → capability-matching → SELECTION_PENDING (no pre-selection recorded; the user has not chosen a scope — pause at the menu).
- Non-goals: App Store submission, store metadata, new product features beyond the four goals, web-app redesign.
- Authority: product source read-only until the selection gate; then local edits within the selected scope only. No git commits/pushes, no deploys, no EAS builds (billable), no external messaging without explicit user approval. **Never mutate the production backend** `https://homeops-ai.onrender.com` — it holds live family data; health checks only. Forbidden: `.env` files, `server/.data/` vault contents, any secret material.

## Observed facts

- Repo state: branch `main` @ `c0c4596`, in sync with `origin/main`, worktree clean except `.top-gun/` mission files. Recent commits landed both prior Top Gun runs (test isolation + CI proof, TestFlight feedback bundle WP-001..004, 6 TestFlight bug fixes).
- Prior missions (historical, revalidate before relying): run-20260719-073933 (web full slate, COMPLETE) and run-20260719-232201 (TestFlight feedback bundle, COMPLETE — declared gaps: native visual check pending next TestFlight build, needsApproval live path DEC-08, **a pre-existing web-smoke mismatch in the topgun suite**). Registers under `.top-gun/runs/run-20260719-232201/audit/`.
- Codebase map (fresh this session, Explore agent): React 18 + Vite 8 + Tailwind web PWA (`src/`, ~57 TS files, 18 screens + 3 role-scoped views); zero-dependency Node backend (`server/index.mjs` ~3,310 lines, 31 modules, `node:sqlite` tenant store + AES-256-GCM vault, 57 test files, ~141+ tests); Expo SDK 56 / RN 0.85 mobile app (`apps/mobile/`); 4-job GitHub CI (`.github/workflows/ci.yml`); topgun E2E (`tests/topgun/`: web-chromium, web-webkit-iphone, PWA, Appetize, Appium projects).
- Rebrand state: `src/brand.ts` = "FamiliOS" (declared single rename point), but app `README.md` is titled "HomeOps AI", env vars use `HOMEOPS_*` prefix (`render.yaml`: `HOMEOPS_DATA_DIR`, `HOMEOPS_SECRET_KEY`), Render service is named `homeops-ai`, and ~13 server modules reference HomeOps.
- Mobile durable-run gap (from iteration log 2026-07-03, revalidate in current source): `apps/mobile` plan dispatch is client-orchestrated (`run-context.tsx` via createApproval + runStep) — runs are not durable server runs; this blocks the mobile email-review card and ask-for-changes re-planning. Server durable entry exists: `POST /api/runs/start`.
- Node runtimes on host: default `node` = v20.20.2 (**below** package engines `>=22.13 <25` — `node:sqlite` requires 22.13+); nvm has v25.8.2 (used by both prior missions, works despite being above the declared range) and v22.12.0 (also below 22.13). Use `C:\Users\rhixon\AppData\Roaming\nvm\v25.8.2\node.exe` explicitly.
- Local servers NOT running at handoff (backend :8787, Vite :5173 both down). Prior runs started them from repo root.
- Network: TLS-intercepted host — node CLIs need `NODE_EXTRA_CA_CERTS=C:\Users\rhixon\OneDrive - 1910 Legacy Enterprises\Desktop\cert-file.cer` per command; npm already configured. No `gh` CLI; GitHub token via `git credential fill`. Repo `Rossistance/HomeOps` (private).
- Render deploy: auto-deploy on push **broke ~2026-07-20** (pushes 2c53541/c0c4596 produced no deployment; old bundle live). No RENDER_API_KEY/CLI locally; deploy verification is by hashed bundle name on the live site. Any env-var rename (`HOMEOPS_*`) is deploy-affecting and currently cannot be rolled out from this machine.
- Runtime drivers (prior-session probes, reconfirm if load-bearing): `playwright-web` usable (v1.61.1, config present); `appium-device-cloud` blocked (missing BROWSERSTACK_* creds); `appetize-sim` blocked (missing APPETIZE_* creds + no simulator build). TestFlight EAS builds work headlessly from `apps/mobile` (billable — user authorization required; ascAppId 6789297381).

## Supported inferences

- Goal 2 (full topgun pass) likely requires fixing the declared pre-existing web-smoke mismatch and rerunning `topgun:web`, `topgun:web:ios`, `topgun:pwa`; the Appetize/Appium projects stay blocked without user-side credentials. Basis: run-2 completion notes + package scripts.
- Goal 3 (real-provider demo) requires a reachable AI provider (local Ollama/LM Studio or a user-supplied cloud key) and a connected Google account against the LOCAL backend. Whether any provider key or Google connection exists in the local vault is unknown — discriminating check below. Without one, the goal is user-blocked, not implementable.
- Goal 1 (rebrand) splits into safe-local (README, server module strings, docs) vs deploy-coupled (env var names, Render service name). The deploy-coupled half interacts with the broken auto-deploy and should be sequenced or explicitly deferred with a migration note. Basis: render.yaml + deploy-state memory.
- Goal 4 (mobile durable-run migration) is a mobile-architecture change verifiable to the API boundary locally (Playwright cannot drive Expo native; Expo web/dev-server may allow partial verification — investigate honestly). Basis: runtime-driver blocks + iteration-log deferral rationale.

## Unknowns and open questions

- Does the local vault hold any active AI provider or a connected Google account? → query `/api/ai/providers`, `/api/connectors` against a locally started backend.
- Exact current failure signature of the topgun web-smoke mismatch. → run the smoke subset and capture output.
- Full inventory of user-visible "HomeOps" strings (README, docs, server modules, mobile app, PWA manifest, seed data). → repo-wide grep + classification.
- Whether `POST /api/runs/start` covers everything mobile dispatch needs (auth mode, approval hand-off, step streaming) or needs extension. → read route + mobile run-context source.
- Is Ollama/LM Studio installed on this host (would unblock goal 3 without a cloud key)? → probe localhost:11434 / LM Studio default port.

## Authority and safety limits

- Local backend only for behavioral verification; production `homeops-ai.onrender.com` is health-check-only.
- No EAS builds, deploys, git mutations, external sends (email/SMS), or OAuth app registrations without explicit user approval in chat.
- Real family data may appear in local `server/.data/` — never copy it into mission files; sanitize per mem contract.

## Capability inventory summary

- Use now: Read/Grep/Glob/Edit/Write, Bash+PowerShell, python 3.14, node v25.8.2 (explicit path), npm test suite, playwright-web topgun harness, Playwright MCP + Claude Browser pane + chrome-devtools MCP, Explore/Plan/general-purpose agents, top-gun lead agents (audit/matching/implementation), mem scripts, discovery report + two prior-run registers (historical).
- Use if needed: WebSearch/WebFetch, GitHub API via credential fill, Render bundle-hash deploy verification, `npx expo` local dev server for mobile (no builds).
- Blocked: appium-device-cloud, appetize-sim (user-side creds), Render deploys (broken auto-deploy, no API key), EAS builds (billable, needs user authorization), cloud AI providers (unless a key exists in the vault or user supplies one).

## Artifact links

- Discovery report: `D:\FamiliOS\.app-angel\familios\01-discovery.md` (register as snapshot at handoff).
- Prior-run registers: `.top-gun/runs/run-20260719-073933/`, `.top-gun/runs/run-20260719-232201/` (historical).

## Next discriminating checks

1. Start the local stack with node v25.8.2; query `/api/ai/providers` and `/api/connectors` to establish goal-3 feasibility honestly.
2. Run `npm run topgun:web` (or the smoke subset) to capture the current web-smoke failure signature.
3. Grep the full repo for HomeOps/homeops/HOMEOPS occurrences and classify safe-local vs deploy-coupled.
4. Read current `apps/mobile` run-dispatch source + the server `POST /api/runs/start` route to size the durable-run migration.
5. Confirm `npm test` passes on v25.8.2 as the baseline health check.
