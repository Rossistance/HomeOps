# HomeOps iOS Redesign — Requirements & Architecture (2026-07-05)

## Problem

The TestFlight build works but reads as an unfinished MVP next to the web/PWA client:
static screens (zero animation despite Reanimated being installed), no dark mode, no
haptics, system-font-only typography, duplicated inline styles, several "manage on web"
stubs — and roughly half the web app's features are missing. Separately, Google OAuth
connect stranded users on a web page inside the auth browser (fixed server-side, see
"OAuth" below).

## Feature gap matrix (web/PWA → mobile before this redesign)

| Capability | Web/PWA | Mobile (before) | This redesign |
|---|---|---|---|
| Dashboard/briefing | Full (briefing, quick actions, approvals, today) | Basic lists | ✅ Redesigned Home with briefing, today, approvals, quick actions |
| Ask HomeOps | Streaming SSE, markdown, plan/build cards, inline approvals | Non-streaming, plain text | ✅ Streaming via `expo/fetch`, markdown rendering, redesigned cards |
| Messages (threads) | Inbox, reply, escalate/resolve | **Missing** | ✅ New Inbox tab (threads + approvals + notifications) |
| Tasks & lists | Create/edit via dashboard + lists | Read-only on Home; groceries inside Meals | ✅ New Tasks & Lists screen (full CRUD, lists, assign, due) |
| Calendar | Create/edit/delete, month grid, Google push/pull | Create only, list view | ✅ Edit + delete + Google sync actions; agenda-first layout |
| Meals | Full | Full (unpolished) | ✅ Redesigned |
| Agents | Create/run/pause/duplicate/delete | **Missing** | ✅ New Agents screen (list, status, run, pause/activate) |
| Automations | List/toggle/test + 8-tab builder | **Missing** | ✅ New Automations screen (list, enable/disable, test, run history) |
| Skills / Functions | Desktop builder | Missing | ❌ Non-goal (desktop-first JSON editors) — view on web |
| Mini Apps | Template instances, live-synced | **Missing** | ❌ Deferred (needs a native renderer; data already reachable via Tasks/Calendar) |
| Files & Knowledge | Upload, search, filter | Upload, no search | ✅ Search + redesigned browser |
| Activity | Full run history | Audit log only | ✅ Server runs (`GET /api/runs`) + audit |
| Household & Spaces | Manage members/spaces | Read-only roster | ✅ Redesigned read-only (management stays web/admin) |
| Connections | OAuth, health, unlink | OAuth connect only | ✅ Redesigned; connect + status (unlink stays web) |
| Settings | AI providers, risk, PIN, Calm Mode | Providers + risk; PIN/Calm stubs | ✅ Providers + risk redesigned; native Reduce-Motion honored; PIN stays web |
| Dark mode | n/a (web is light) | None | ✅ Full dark palette |

## Non-goals (explicit)

- Mini Apps native renderer, Skills/Functions builders, month-grid calendar, on-device
  PIN management, spaces/member administration. All remain available on web; screens
  link out honestly rather than stubbing.

## Architecture fit (ADR)

Additive redesign inside `apps/mobile` — same Expo SDK 56 + expo-router + bearer-token
API client (`src/lib/api.ts`, unchanged surface), same backend. No backend restructuring;
only the OAuth callback gained a mobile-aware response. Rollback = revert the mobile tree.

**Navigation** moves from a flat 13-route classic tab bar + "More" hub to native iOS
structure: **NativeTabs (5): Home · Calendar · Ask · Inbox · More**, each tab a Stack
with `headerLargeTitle`, secondary screens pushed within tabs (`more/` group keeps
Meals, Tasks, Files, Agents, Automations, Playbooks, Household, Contacts, Activity,
Connections, Settings). Create/edit flows present as form sheets.

**Design system v2 — "Tactile Hearth, native":** `src/theme/` (tokens: light+dark warm
paper/ink ramps, ember accent, spacing/radii/type scale), Fraunces (display) + Inter (UI)
via `@expo-google-fonts/*`, SF Symbols via `expo-image` `sf:` sources, Reanimated
entering/layout transitions + pressable scale, `expo-haptics` on decisive actions,
skeleton loaders, first-class empty/error/offline states. Calm-by-default: honors
`prefers-reduced-motion` (AccessibilityInfo) and drops glow/motion accordingly.

## OAuth (fixed in this pass)

- Server: mobile-initiated flows are marked in the OAuth `state` string (`<provider>.m.<nonce>`);
  the callback now serves an auto-redirecting interstitial with a tap-through
  "Return to HomeOps" `homeops://` link for **success and every failure path** — the user
  can no longer be stranded on a web page inside ASWebAuthenticationSession
  (`server/index.mjs` callback + start route).
- Mobile: parses `ok=0` error deep links, always refreshes the provider list after the
  auth browser closes (`apps/mobile/src/app/connections.tsx`).
- Requires: Render redeploy (server fix benefits the already-shipped TestFlight build)
  and a new EAS build for the state-marker + UI improvements.
