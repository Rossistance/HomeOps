# Discovery — FamiliOS
_Updated: 2026-07-20_

> Discovery for an **existing, mature, substantially-shipped** product. FamiliOS is
> the rename/evolution of HomeOps AI (see `.app-angel/homeops-ai/` for the full
> prior history: discovery 2026-06-23, spec, and a 2,000-line iteration log through
> 2026-07-03). This pass re-anchors discovery on (a) a fresh full-codebase map of
> `D:\FamiliOS\FamiliOS` and (b) refreshed 2026 competitor research with sources.

## 0. Current product state (codebase-verified, 2026-07-20)

- **What it is:** a family/household "agent teams" OS — natural language →
  plan → server-enforced approval → real execution via connectors → durable run
  history and audit. Web (React 18 + Vite + Tailwind + Zustand, PWA) + Expo/RN
  mobile app (`apps/mobile/`) + zero-dependency Node backend (`server/`,
  ~3,300-line `index.mjs`, `node:sqlite` tenant store + AES-256-GCM vault).
- **Real, not mocked:** demo adapters were removed; connectors honestly report
  `not_configured` / `needs_auth` / `runtime_unavailable`. OAuth providers:
  Google (Gmail/Calendar), Microsoft, Slack, Dropbox, Notion, Todoist, TickTick,
  Alexa. Live-without-keys: Weather (Open-Meteo), Webhook receiver (HMAC).
  Others: RSS, HTTP, SMS/Twilio, Browser (Playwright boundary), files-local.
- **AI providers:** OpenAI, Anthropic, Gemini, OpenAI-compatible, Ollama,
  LM Studio — truthful health states; deterministic local fallback with no key.
- **Verification tooling:** 57 server test files (`node --test`), 4-job GitHub CI
  (server tests, data-isolation gate, web typecheck+build, mobile typecheck+
  export), and a **"topgun" Playwright/Appetize/Appium E2E suite**
  (`tests/topgun/`, npm scripts `topgun:web|pwa|appetize|ios`).
- **Known honest limitations (README):** most connectors need owner credentials;
  browser runtime opt-in via `BROWSER_RUNTIME_URL`; cloud AI needs a key.
- **Rebrand debt:** `src/brand.ts` says "FamiliOS" (single rename point), but the
  app README, `HOMEOPS_*` env vars, `render.yaml` service name, and ~13 server
  modules still say HomeOps.

Sources: Explore-agent codebase map (this session) — key files
`FamiliOS/package.json`, `src/brand.ts`, `server/index.mjs`,
`server/connectors.mjs`, `server/providers.mjs`, `server/ai.mjs`,
`.github/workflows/ci.yml`, `docs/adr/ADR-001-tenant-storage.md`.

## 1. Problem & audience

Families and households drown in operational admin — scheduling, school forms,
bills, documents, caregiving, errands — scattered across email, calendars,
drives, and single-purpose apps. The mental load concentrates on one person;
industry coverage in 2026 frames it as "families spend 30+ hours per week
coordinating life, and most of it lives in one person's head." Audience: busy
parents/caregivers running a household, explicitly including neurodivergent
users and mixed-age members needing role-safe, low-stimulation views (FamiliOS
ships Kid/Sitter/Grandparent scoped screens).

Sources: prior HomeOps discovery + deep-research report; 2026 market coverage —
[AlphaMa mental-load app roundup](https://alphamothers.com/compare/best-app-for-mental-load),
[Digital Trends: The Family AI Household Economy](https://www.digitaltrends.com/contributor-content/the-family-ai-household-economy-ais-emerging-consumer-opportunity/).

## 2. Day-one core features (all SHIPPED unless marked)

- **Ask FamiliOS assistant** — streaming chat: NL → plan → approval → execution → history; plus "build mode" that generates agents/skills/functions.
- **Server-enforced approvals** — consume-once, input-hash-bound, role-gated; inline approvals in chat and run history; master kill switch.
- **Real connector execution** — Google Gmail/Calendar + Weather/RSS/HTTP/Webhook/SMS/Browser; 8 OAuth providers framework-ready.
- **History, audit & memory** — durable runs, append-only audit with redaction, auto-captured household memory from run traces.
- **Family roles & spaces** — households, invites, Kid/Sitter/Grandparent scoped views, risk overrides.
- **Household surfaces** — Calendar (Google sync, ICS, RRULE), Meals, Tasks, Files/Knowledge, Messages/notifications (in-app, email, SMS), Mini apps (8 starter templates).
- **Evolution loops** — evidence-backed improvement proposals from real run traces, reviewable and applyable.
- **Mobile app** — Expo iOS client mirroring core loop (some surfaces deferred: durable-run dispatch, mini apps, function builder — web-only by design).

## 3. Competitors & gaps (refreshed 2026-07)

| Competitor | What they're missing vs FamiliOS |
|------------|----------------------------------|
| Ohai.ai ($9.99/mo, mobile-first AI household assistant; strong calendar conflict detection) | Organizes and suggests; no arbitrary real-world **execution across connected accounts** behind a server-enforced approval gate, no role-scoped family views, no auditable run history |
| SuperNori / Nori (Domus Next, "proactive family AI agent") | Proactive reminders/recommendations, not approval-gated multi-step action execution; no self-improvement loop from run traces |
| Milo (SMS-first GPT-4 family copilot) | Capture-and-digest only — turns messages into tasks; doesn't act on email/calendar/web on your behalf |
| Norton Family Assistant (beta, June 2026) | Security-brand family agent; early beta, parental-management slant; no open connector platform, agents, or user-built skills/mini-apps |
| Cozi / Maple (family organizers) | Calendars, lists, chores/allowance ledgers — no agentic AI that executes; AI is augmentation only |
| Skylight / Hearth (hardware family hubs, $150–630 + subscription) | Display-first; Sidekick AI assists scheduling but takes no external actions; no approvals/audit/roles beyond the calendar |
| ChatGPT/Claude/Gemini general assistants + Zapier/IFTTT | Either no household connectors/roles/approvals/durable history, or trigger-action wiring that isn't conversational, family-safe, or approval-reviewed |

**Positioning takeaway:** the 2026 field is crowded on *organization* (calendars,
tasks, digests) but nearly empty on **approval-gated real execution with roles +
audit** — FamiliOS's core loop remains the differentiator. The category norm is
converging on "waits for approval before acting" language, so speed-to-market on
the execution story matters.

Sources: [Ohai.ai](https://www.ohai.ai/) · [Ohai review — Agent Finder](https://agent-finder.co/reviews/ohai) ·
[Carly: Ohai alternatives 2026](https://www.usecarly.com/blog/ohai-alternatives/) ·
[Norton Family Assistant announcement (2026-06-04)](https://newsroom.gendigital.com/2026-06-04-Norton-Introduces-Family-Assistant,-the-Secure-AI-Agent-Built-to-Help-Families-Manage-the-Chaos-of-Modern-Parenting-in-the-Digital-Age) ·
[Nori: family operations system](https://heynori.com/blog/family-operations-system/best-ai-family-organizer) ·
[Maple: best family calendar apps](https://www.growmaple.com/blog-posts/best-family-calendar-app) ·
[AlphaMa comparisons](https://alphamothers.com/compare/best-apps-for-mom-mental-load) ·
[Alignify family-assistant roundup](https://alignify.co/tools/family-assistant).

## 4. 30-day success (from current state)

- **Rebrand completed end-to-end**: no user-visible or operational "HomeOps"
  remnants (README, `HOMEOPS_*` env vars, Render service name, server modules).
- **Full topgun E2E pass**: `topgun:web`, `topgun:web:ios`, `topgun:pwa` green;
  iOS pass on Appetize or device where feasible.
- **Real-provider demo**: the canonical loop demonstrated end-to-end with a
  reachable AI provider and a connected Google account (email triage or calendar
  event through approval → execution → history), recorded in the iteration log.
- **Mobile parity milestone**: mobile plan dispatch moved to the durable server
  engine (`POST /api/runs/start`) — the flagged prerequisite for mobile email
  review and re-planning.
- CI stays green: 141+ server tests, typecheck, build, data-isolation gate.

## 5. Day-one integrations

- **Google (Gmail/Calendar)** — flagship real connector family (OAuth + vault).
- **AI providers** — OpenAI / Anthropic / Gemini / OpenAI-compatible / Ollama / LM Studio.
- **Live no-key** — Weather (Open-Meteo), Webhook receiver (HMAC).
- **Configured-by-owner** — SMS (Twilio), RSS, HTTP, Browser runtime (Playwright, `BROWSER_RUNTIME_URL`), files-local.
- **Framework-ready OAuth** — Microsoft, Slack, Dropbox, Notion, Todoist, TickTick, Alexa (need owner-registered OAuth apps).
- **Ops** — Render deploy (`render.yaml`), RevenueCat webhook (monetization hook present).

## Open questions

- **Rebrand scope**: rename `HOMEOPS_*` env vars and the Render service, or keep
  them as internal legacy identifiers? (Renaming env vars is a deploy-breaking
  change needing a migration note.)
- **Monetization**: RevenueCat webhook and `docs/COMMERCIALIZATION_PLAN.md`
  exist — pricing/packaging not yet decided in memory.
- **Mobile durable-run migration**: scheduled but unsized; blocks three deferred
  mobile features (email review card, ask-for-changes, durable dispatch).
- **Provider app ownership**: one-click Google/MS/Slack connect still requires
  owner-registered OAuth apps + credentials (platform-policy limit).
- **Competitive depth**: this pass used secondary roundups + vendor sites;
  no hands-on trials of Ohai/Nori/Norton beta.
