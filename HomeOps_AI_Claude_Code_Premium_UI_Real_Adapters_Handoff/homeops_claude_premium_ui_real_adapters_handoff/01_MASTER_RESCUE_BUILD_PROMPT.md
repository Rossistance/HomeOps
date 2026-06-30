# Master Rescue Build Prompt — Premium UI + Real Adapters

## Mission

Rebuild the existing HomeOps AI app into a premium family operating system and real connector platform.

The current application is a starting codebase, not an acceptable product. It includes useful structure, screens, state, and data models, but it still looks like a low-quality dashboard product and relies on demo/mock adapters. This pass must fix both.

## Product target

HomeOps AI should feel like a polished, high-trust family operating system for:

- Parents
- Couples
- Individuals
- Caregivers
- Roommates
- Busy households
- Solo professionals managing personal operations

It should help users coordinate family life, documents, messages, schedules, errands, caregiving, bills, routines, travel, school, and recurring life workflows through AI helper agents and real connected services.

## Product competitors to keep in mind

The product should feel visually credible beside modern personal productivity, family coordination, calendar, notes, and AI assistant applications. Do not copy any one product, but match the care level: polished surfaces, intentional hierarchy, excellent typography, subtle motion, thoughtful empty states, and a trustworthy AI-first control model.

## Existing app assessment

The current codebase has useful foundations:

- React/Vite/TypeScript app
- Zustand state
- IndexedDB persistence
- Core screens
- Seeded family data
- Agents
- Automations
- Connections
- Messages
- Files/Knowledge
- Mini apps
- Spaces
- Playbooks
- Activity
- Settings

But it fails the target product bar because:

- The UI feels generic and underdesigned.
- It is visually card-heavy without a strong information architecture.
- It lacks the warmth, polish, depth, and confidence of a premium family OS.
- The connector system remains demo-mode.
- The app tells the user external integrations are simulated.
- “Authorize demo” and similar affordances destroy credibility.
- Browser workflows, webhooks, AI providers, and external actions are still placeholders.
- There is no real backend boundary for OAuth, webhooks, background jobs, secrets, scheduled runs, or browser automation.

## Required outcome

Transform the app so that:

- The UI feels premium and intentional.
- The dashboard feels like the family command center.
- Navigation feels designed, not generated.
- Agents feel like real operational helpers.
- Connections feel like a serious integration platform.
- All demo/mock adapter surfaces are removed.
- Real connector infrastructure exists.
- Unsupported/unconfigured connectors are honest and disabled, not simulated.
- Browser automation has a real backend/runtime boundary.
- Webhooks have a real receiver route or clearly defined backend endpoint.
- Tools, triggers, approvals, execution, and audit are real application concepts.
- All high-risk actions are blocked behind approval.

## Absolute bans

Do not leave:

- Demo adapter labels
- Simulated success states
- Fake OAuth authorization
- Fake webhook URLs that pretend to receive real data
- Fake browser workflows that pretend to log in or download files
- Mock AI provider toggles that imply real generation
- “Future adapter” text as the primary outcome
- “Coming soon” as an implementation substitute
- Generic dashboard cards as the final design

## Required adapter policy

If a connector cannot perform a real external action because credentials or provider setup are missing, it must be shown as:

- Not configured
- Setup required
- Disabled for execution
- Described with real configuration steps
- Excluded from successful agent runs until configured

This is acceptable. Simulating success is not acceptable.

## Backend requirement

If the existing app is frontend-only, add the necessary backend boundary or package structure to support:

- OAuth initiation/callback
- Secret storage abstraction
- Token refresh
- Webhook receiver
- Background job scheduler
- Tool execution
- Server-side connector calls
- Browser automation sessions
- Audit logging

The backend can be lightweight and local-development focused, but the architecture must be real.

## Development sequencing

Follow `10_IMPLEMENTATION_SEQUENCE_CLAUDE_CODE.md`.

Do not begin by writing tests. Complete the redesign and adapter infrastructure first, then validate.
