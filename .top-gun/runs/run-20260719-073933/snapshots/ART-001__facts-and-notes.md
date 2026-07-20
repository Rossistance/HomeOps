# Facts and Notes — Mission Handoff

- Run: run-20260719-073933
- Goal: Convergent 360 exploratory audit of FamiliOS (homeops-ai): hunt bugs, broken functions, workflows and links, UI/UX and design critique vs DESIGN_SYSTEM.md, CI/CD and code debt review, improvements and additions - executed as a mobile smartphone-user simulation in the browser emulator; deliver master report, brownfield PRD, work packages, numbered menu; stop at the selection gate
- Prepared by: top-gun (orchestrator), 2026-07-19

## Mission and boundaries

- Scope: the repository `D:\HomeOps\homeops-ai` (git root, branch `main`) and its locally running product. Audit only — no product-source changes before the selection gate.
- Success: validated master report + brownfield PRD + work packages + numbered implementation menu covering the user's hunt list (bugs, broken functions/workflows/links, UI/UX, CI/CD, code debt, code review, improvements, additions, design critique), grounded in mobile smartphone-user simulation evidence.
- Non-goals this phase: implementation, deployment, git mutations, external publication.
- Authorization boundary: product source, git state, production/Render, and all external services are read-only. Local app state created through normal in-app use (IndexedDB, server/.data) is permitted. **No real external side effects**: backend reports `externalActionsEnabled: true`, so do NOT execute connector actions that message, pay, or mutate anything external. Weather (Open-Meteo) is a real read-only call and is acceptable. Never configure OAuth providers. Never trigger SMS.
- Files that must never be read or quoted: `D:\HomeOps\homeops-ai\.env`, `D:\HomeOps\SubscriptionKey_3A6LNPV3XG.p8`, `D:\HomeOps\twilio_2FA_recovery_code.txt`, anything under `server/.data/` vault files. `.env.example` is fine.
- Preserve untouched: the pre-existing dirty file `.claude/launch.json` (modified before this mission) and all of `node_modules/`, `dist/`, `.git/`.

## Observed facts

- Product: "FamiliOS / HomeOps AI — Personal agent teams for family life and household admin" (package.json description; README title "HomeOps AI"; page title "FamiliOS"). Naming is split between HomeOps AI and FamiliOS across README/package/UI.
- Stack: React 18.3 + Vite 8.0.16 + Tailwind 3.4 + Zustand 5 + react-router-dom 6.28 + idb 8 (local-first IndexedDB) + vite-plugin-pwa; TypeScript 5.6. Backend: dependency-free Node http server `server/index.mjs` ("control plane v1.2.0") with routes for health, connectors, tools/execute, oauth, webhooks, jobs, browser, audit, settings; AES-256-GCM secrets vault in `server/store.mjs`; `server/.data/` runtime state. A separate `homeops-browser-runtime v1.0.0` listens on :9223. Playwright is a production dependency.
- Also present: `apps/mobile` (Expo/EAS app with its own CLAUDE.md; eas.json, app.json at root), `mobile-version/`, `.github/` (CI), `render.yaml` (Render blueprint), `DESIGN_SYSTEM.md`, `docs/`, `outputs/`, `dist/` (a previous build), `.env` (exists — unread).
- Git: branch main; HEAD ffcfa33 2026-07-12 "Fix 6 TestFlight bugs: scoped logout, offer-help, avatar visibility, chat keyboard, run feedback, evolution auto-approve"; exactly one dirty file (`.claude/launch.json`).
- Runtime truth (this run): backend healthy at http://localhost:8787/api/health → `{ok:true, version:"1.2.0", node:"v25.8.2", env:"development", browserRuntime:true, externalActionsEnabled:true}`; web at http://localhost:5173 (Vite dev, proxies /api); browser runtime at :9223. First screen at 375x812 is an onboarding: "Welcome to FamiliOS … Everything stays on this device until you connect a provider" with cards Create household / Restore a backup / a third card below the fold; footer elsewhere shows SMS compliance copy + Privacy Policy / SMS Terms & Conditions / Support links (evidence SS-000).
- Node version contradiction (three-way): README says "Node 18+ (built on Node 20)"; package.json engines demands ">=22.13 <25"; the repo's own `.claude/launch.json` runs `nvm\v25.8.2\node.exe`; installed nvm versions are 20.20.2 / 22.12.0 / 25.8.2 — none satisfies engines. The app demonstrably runs on v25.8.2.
- Stability observation: on first `npm run dev` (node v25.8.2), the Vite child crashed with exit 3221225477 (0xC0000005 access violation) during "Re-optimizing dependencies"; a direct relaunch succeeded in 2.5s (warm cache). `scripts/dev.mjs` also emits DEP0190 ("Passing args to a child process with shell option true … security vulnerabilities").
- Backend CORS/origins line includes LAN addresses: `http://192.168.4.24:8787`, `http://192.168.4.24:8081`.

## Supported inferences

- FamiliOS is the product name and HomeOps AI the project/former name (based on README vs UI title divergence) — verify in copy audit.
- The product is local-first with server-mediated external actions behind approval gates (README claims; verify in trace audit).
- The TestFlight commit message implies an active iOS distribution via `apps/mobile`; the web app at mobile viewport is the primary audit surface for this mission, with `apps/mobile` in scope for code/CI review only (not device simulation).
- Prior audit/QA tooling has run here before (`.playwright-mcp/`, `.app-angel/` in parent, QA logs in parent) — treat any of their outputs as historical, not current evidence.

## Unknowns and open questions

- Does `npm run build`/`typecheck`/`test` pass at baseline? (Discriminating check: run them read-only during S1 and record baseline health.)
- What do the `.github` workflows actually gate? (Read workflows in Track B / CI-CD review.)
- Does the deployed Render URL exist/match `render.yaml` claims? (Do NOT probe production mutatively; a single read-only GET is acceptable if a URL is discoverable.)
- What is the third onboarding card below the fold, and does "Explore the sandbox" (if that's what it is) seed demo data? (First persona journey.)
- Are the footer links (Privacy Policy / SMS Terms / Support) real routes or dead links? (Broken-link hunt.)
- Production/source parity: `dist/` age vs current source (check build stamps; do not trust dist as current).

## Authority and safety limits

- In-app Browser pane: partially blocked this session — initial load worked but screenshots hang and new navigations are denied (origin-approval gate with no interactive user). RECORDED FALLBACK per mandate: use Playwright MCP for all product interaction. Do not use the in-app Browser pane.
- Playwright MCP verified working: navigate, resize 375x812, screenshot (file), a11y snapshot, click, type, drag, console, network. Screenshots land relative to the MCP output dir — copy final evidence into this run's `audit/evidence/` and inspect every image before indexing.
- No git commits/pushes/PRs, no deploys, no external messages, no connector executions with external side effects, no OAuth setup, no reading secret files listed above.

## Capability inventory summary

- use now: Playwright MCP (emulator), Read/Grep/Glob (source), Bash/PowerShell (read-only + validators), python 3.14 (mission scripts), git (read-only), Agent tool (general-purpose subagents), backend HTTP API on :8787 (read-only endpoints + safe local tools), mission scripts under `D:\The Only Skill\top-gun-claude\skills\*\scripts`.
- use if needed: chrome-devtools MCP (perf/a11y deep dives), `npm run test|typecheck|build` (baseline health, read-only side effects in-repo only), design/product skills if exposed to subagent.
- unavailable/blocked: in-app Browser pane (reason above); claude.ai connectors requiring OAuth (not needed).

## Artifact links

- SS-000: `audit/evidence/SS-000-bootstrap-mobile-onboarding.jpeg` — first mobile screenshot, inspected: renders onboarding correctly at 375x812.
- Facts handoff: this file (registered as snapshot at dispatch).

## Next discriminating checks

1. Baseline health: `npm run typecheck`, `npm test`, (optionally `npm run build`) — record pass/fail before any conclusions about "broken".
2. Route inventory: enumerate react-router routes in `src/` and map the functionality denominator.
3. First persona journey: fresh onboarding → Create household → dashboard, at 375x812, with screenshot+trace pairing.
4. Footer/legal links + every nav destination: broken-link sweep.
5. `.github` workflows + render.yaml: CI/CD reality check.
